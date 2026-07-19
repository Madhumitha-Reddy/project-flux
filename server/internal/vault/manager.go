package vault

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/flux-pkm/server/internal/domain"
	"github.com/flux-pkm/server/internal/files"
	"github.com/flux-pkm/server/internal/index"
	watcherRuntime "github.com/flux-pkm/server/internal/watcher"
	"github.com/google/uuid"
)

var (
	ErrNotConfigured = errors.New("no vault is configured for this server")
	ErrPathRequired  = errors.New("vault path is required")
	ErrNotOpen       = errors.New("vault is not open")
	ErrVaultMismatch = errors.New("requested vault is outside the configured vault")
	ErrNestedVault   = errors.New("nested vaults are not supported")
)

type identity struct {
	VaultID            string `json:"vault_id"`
	VaultFormatVersion int    `json:"vault_format_version"`
}

type Context struct {
	state    sync.RWMutex
	changeMu sync.Mutex
	info     domain.VaultInfo
	Files    *files.Service
	Index    *index.Store
	Watch    *watcherRuntime.Watcher
	Revision atomic.Uint64
	changed  chan struct{}
	root     string
}

func (c *Context) bumpRevision() {
	c.Revision.Add(1)
	c.changeMu.Lock()
	close(c.changed)
	c.changed = make(chan struct{})
	c.changeMu.Unlock()
}

func (c *Context) WaitRevision(ctx context.Context, after uint64) uint64 {
	for {
		current := c.Revision.Load()
		if current != after {
			return current
		}
		c.changeMu.Lock()
		current = c.Revision.Load()
		changed := c.changed
		c.changeMu.Unlock()
		if current != after {
			return current
		}
		select {
		case <-changed:
		case <-ctx.Done():
			return c.Revision.Load()
		}
	}
}

func (c *Context) VaultInfo() domain.VaultInfo {
	c.state.RLock()
	defer c.state.RUnlock()
	return c.info
}

func (c *Context) degrade() {
	c.state.Lock()
	defer c.state.Unlock()
	c.info.State = domain.VaultStateDegraded
}

type Manager struct {
	configuredPath string
	allowAnyPath   bool
	mu             sync.RWMutex
	context        *Context
}

func NewManager(configuredPath string, allowAnyPath bool) *Manager {
	return &Manager{configuredPath: configuredPath, allowAnyPath: allowAnyPath}
}

func (m *Manager) Configured() bool {
	return m.configuredPath != ""
}

func (m *Manager) Open(requestedPath string) (*Context, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	root, err := m.resolveRoot(requestedPath)
	if err != nil {
		return nil, err
	}
	if m.context != nil && samePath(m.context.root, root) {
		return m.context, nil
	}

	fluxDirectory := filepath.Join(root, ".flux")
	if err := os.MkdirAll(fluxDirectory, 0o700); err != nil {
		return nil, err
	}
	vaultIdentity, err := loadOrCreateIdentity(filepath.Join(fluxDirectory, "vault.json"))
	if err != nil {
		return nil, err
	}
	fileService := files.New(root)
	state := domain.VaultStateReady
	if _, purgeErr := fileService.PurgeTrash(30*24*time.Hour, time.Now().UTC()); purgeErr != nil {
		state = domain.VaultStateDegraded
	}
	indexStore, indexErr := index.Open(filepath.Join(fluxDirectory, "index.db"))
	if indexErr != nil {
		state = domain.VaultStateDegraded
	} else if entries, listErr := fileService.List(); listErr != nil || indexStore.ReplaceFiles(entries) != nil {
		state = domain.VaultStateDegraded
	}

	next := &Context{
		info: domain.VaultInfo{
			ID:    vaultIdentity.VaultID,
			Name:  filepath.Base(root),
			State: state,
		},
		Files:   fileService,
		Index:   indexStore,
		changed: make(chan struct{}),
		root:    root,
	}
	next.Revision.Store(1)
	next.Watch, err = watcherRuntime.Start(root, func() {
		next.bumpRevision()
		if next.Index == nil {
			return
		}
		entries, listErr := next.Files.List()
		if listErr != nil || next.Index.ReplaceFiles(entries) != nil {
			next.degrade()
		}
	})
	if err != nil {
		next.degrade()
	}
	if m.context != nil {
		if m.context.Watch != nil {
			_ = m.context.Watch.Close()
		}
		if m.context.Index != nil {
			_ = m.context.Index.Close()
		}
	}
	m.context = next
	return m.context, nil
}

func (m *Manager) Create(requestedPath string) (*Context, error) {
	if requestedPath == "" {
		return nil, ErrPathRequired
	}
	absolute, err := filepath.Abs(requestedPath)
	if err != nil {
		return nil, err
	}
	absolute = filepath.Clean(absolute)
	if m.configuredPath == "" {
		if !m.allowAnyPath {
			return nil, ErrNotConfigured
		}
	} else {
		configured, pathErr := filepath.Abs(m.configuredPath)
		if pathErr != nil {
			return nil, pathErr
		}
		if filepath.Clean(configured) != absolute {
			return nil, ErrVaultMismatch
		}
	}
	if nestedInVault(absolute) {
		return nil, ErrNestedVault
	}
	if _, err := os.Stat(filepath.Join(absolute, ".flux", "vault.json")); err == nil {
		return nil, os.ErrExist
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err := os.MkdirAll(absolute, 0o755); err != nil {
		return nil, err
	}
	return m.Open(absolute)
}

func nestedInVault(root string) bool {
	for current := filepath.Dir(root); ; current = filepath.Dir(current) {
		if _, err := os.Stat(filepath.Join(current, ".flux", "vault.json")); err == nil {
			return true
		}
		parent := filepath.Dir(current)
		if parent == current {
			return false
		}
	}
}

func (m *Manager) resolveRoot(requestedPath string) (string, error) {
	if m.configuredPath == "" {
		if !m.allowAnyPath {
			return "", ErrNotConfigured
		}
		if requestedPath == "" {
			return "", ErrPathRequired
		}
		return canonicalDirectory(requestedPath)
	}

	configuredRoot, err := canonicalDirectory(m.configuredPath)
	if err != nil || requestedPath == "" {
		return configuredRoot, err
	}
	requestedRoot, err := canonicalDirectory(requestedPath)
	if err != nil {
		return "", err
	}
	if !samePath(configuredRoot, requestedRoot) {
		return "", ErrVaultMismatch
	}
	return configuredRoot, nil
}

func (m *Manager) Degrade(vaultID string) {
	m.mu.RLock()
	context := m.context
	m.mu.RUnlock()
	if context != nil && context.VaultInfo().ID == vaultID {
		context.degrade()
	}
}

func (m *Manager) CurrentInfo() *domain.VaultInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.context == nil {
		return nil
	}
	info := m.context.VaultInfo()
	return &info
}

func (m *Manager) Get(vaultID string) (*Context, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.context == nil || m.context.VaultInfo().ID != vaultID {
		return nil, ErrNotOpen
	}
	return m.context, nil
}

func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.context == nil {
		return nil
	}
	var err error
	if m.context.Watch != nil {
		err = m.context.Watch.Close()
	}
	if m.context.Index != nil {
		if closeErr := m.context.Index.Close(); err == nil {
			err = closeErr
		}
	}
	m.context = nil
	return err
}

func canonicalDirectory(directory string) (string, error) {
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("vault path is not a directory")
	}
	return filepath.Clean(resolved), nil
}

func samePath(left, right string) bool {
	leftInfo, leftErr := os.Stat(left)
	rightInfo, rightErr := os.Stat(right)
	return leftErr == nil && rightErr == nil && os.SameFile(leftInfo, rightInfo)
}

func loadOrCreateIdentity(identityPath string) (identity, error) {
	content, err := os.ReadFile(identityPath)
	if err == nil {
		var existing identity
		if err := json.Unmarshal(content, &existing); err != nil {
			return identity{}, err
		}
		if existing.VaultID == "" || existing.VaultFormatVersion != 1 {
			return identity{}, fmt.Errorf("unsupported or invalid vault identity")
		}
		return existing, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return identity{}, err
	}

	id, err := uuid.NewV7()
	if err != nil {
		return identity{}, err
	}
	created := identity{VaultID: id.String(), VaultFormatVersion: 1}
	encoded, err := json.MarshalIndent(created, "", "  ")
	if err != nil {
		return identity{}, err
	}
	encoded = append(encoded, '\n')

	temporary, err := os.CreateTemp(filepath.Dir(identityPath), ".vault-identity-*")
	if err != nil {
		return identity{}, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err := temporary.Write(encoded); err != nil {
		temporary.Close()
		return identity{}, err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return identity{}, err
	}
	if err := temporary.Close(); err != nil {
		return identity{}, err
	}
	if err := os.Rename(temporaryPath, identityPath); err != nil {
		return identity{}, err
	}
	return created, nil
}
