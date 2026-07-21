package vault

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
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
	cancel   context.CancelFunc
	indexing sync.WaitGroup
	jobs     chan []watcherRuntime.Event
	dirty    atomic.Bool
	broken   atomic.Bool
	changes  []revisionChange
}

type revisionChange struct {
	revision uint64
	events   []domain.VaultFileEvent
}

func (c *Context) publish(events []watcherRuntime.Event) {
	fileEvents := make([]domain.VaultFileEvent, 0, len(events))
	for _, event := range events {
		fileEvents = append(fileEvents, domain.VaultFileEvent{Path: event.Path, Op: string(event.Op)})
	}
	c.changeMu.Lock()
	revision := c.Revision.Add(1)
	c.changes = append(c.changes, revisionChange{revision: revision, events: fileEvents})
	if len(c.changes) > 256 {
		c.changes = append([]revisionChange(nil), c.changes[len(c.changes)-256:]...)
	}
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

func (c *Context) RootPath() string { return c.root }

func (c *Context) ListFiles() ([]domain.FileEntry, error) {
	if c.Index != nil {
		return c.Index.ListFiles()
	}
	return c.Files.List()
}

func (c *Context) ChangesSince(after uint64) domain.VaultChange {
	c.changeMu.Lock()
	defer c.changeMu.Unlock()
	current := c.Revision.Load()
	change := domain.VaultChange{Revision: current, Vault: c.VaultInfo()}
	if len(c.changes) == 0 {
		change.Reconcile = after != current
		return change
	}
	if after+1 < c.changes[0].revision {
		change.Reconcile = true
		return change
	}
	for _, entry := range c.changes {
		if entry.revision > after {
			change.Events = append(change.Events, entry.events...)
		}
	}
	return change
}

func (c *Context) degrade() {
	c.state.Lock()
	defer c.state.Unlock()
	c.info.State = domain.VaultStateDegraded
	c.info.Indexing = nil
}

func (c *Context) setLifecycle(state domain.VaultState, progress *domain.IndexingProgress) {
	var snapshot *domain.IndexingProgress
	if progress != nil {
		copy := *progress
		snapshot = &copy
	}
	c.state.Lock()
	c.info.State = state
	c.info.Indexing = snapshot
	c.state.Unlock()
}

func (c *Context) queue(events []watcherRuntime.Event) {
	if len(events) == 0 {
		return
	}
	select {
	case c.jobs <- events:
	default:
		c.dirty.Store(true)
	}
	c.publish(events)
}

type Manager struct {
	configuredPath string
	storageRoot    string
	allowAnyPath   bool
	mu             sync.RWMutex
	context        *Context
}

func NewManager(configuredPath string, allowAnyPath bool) *Manager {
	return &Manager{configuredPath: configuredPath, allowAnyPath: allowAnyPath}
}

func NewStorageManager(storageRoot string) *Manager {
	return &Manager{storageRoot: storageRoot}
}

func (m *Manager) Configured() bool {
	return m.configuredPath != "" || m.storageRoot != ""
}

func (m *Manager) Available() ([]domain.VaultLocation, error) {
	if m.storageRoot == "" {
		return []domain.VaultLocation{}, nil
	}
	if err := os.MkdirAll(m.storageRoot, 0o755); err != nil {
		return nil, err
	}
	root, err := canonicalDirectory(m.storageRoot)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	locations := make([]domain.VaultLocation, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		location := domain.VaultLocation{Name: entry.Name(), Path: filepath.Join(root, entry.Name())}
		content, readErr := os.ReadFile(filepath.Join(location.Path, ".flux", "vault.json"))
		if readErr == nil {
			var existing identity
			if json.Unmarshal(content, &existing) == nil && existing.VaultFormatVersion == 1 {
				location.VaultID = existing.VaultID
			}
		}
		locations = append(locations, location)
	}
	return locations, nil
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
	state := domain.VaultStateReadOnlyReady
	if _, purgeErr := fileService.PurgeTrash(30*24*time.Hour, time.Now().UTC()); purgeErr != nil {
		state = domain.VaultStateDegraded
	}
	indexStore, indexErr := index.Open(filepath.Join(fluxDirectory, "index.db"))
	if indexErr != nil {
		state = domain.VaultStateDegraded
	} else if cached, cacheErr := indexStore.ListFiles(); cacheErr != nil {
		state = domain.VaultStateDegraded
	} else if len(cached) == 0 {
		entries, listErr := fileService.List()
		if listErr != nil || indexStore.ReplaceFiles(entries) != nil {
			state = domain.VaultStateDegraded
		}
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
		jobs:    make(chan []watcherRuntime.Event, 32),
	}
	indexContext, cancel := context.WithCancel(context.Background())
	next.cancel = cancel
	next.Revision.Store(1)
	if state != domain.VaultStateDegraded {
		next.setLifecycle(domain.VaultStateWritable, nil)
	}
	next.Watch, err = watcherRuntime.Start(root, func(events []watcherRuntime.Event) {
		next.queue(events)
	})
	if err != nil {
		next.broken.Store(true)
		next.degrade()
	}
	if next.Index != nil {
		next.indexing.Add(1)
		go next.runIndexer(indexContext)
	}
	if m.context != nil {
		_ = m.context.close()
	}
	m.context = next
	return m.context, nil
}

func (m *Manager) Create(requestedPath string) (*Context, error) {
	if requestedPath == "" {
		return nil, ErrPathRequired
	}
	if m.storageRoot != "" {
		root, err := canonicalDirectory(m.storageRoot)
		if err != nil {
			return nil, err
		}
		name := filepath.Clean(requestedPath)
		if filepath.IsAbs(requestedPath) || name == "." || name != filepath.Base(name) {
			return nil, ErrVaultMismatch
		}
		requestedPath = filepath.Join(root, name)
	}
	absolute, err := filepath.Abs(requestedPath)
	if err != nil {
		return nil, err
	}
	absolute = filepath.Clean(absolute)
	if m.configuredPath == "" {
		if m.storageRoot == "" && !m.allowAnyPath {
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
	if m.storageRoot != "" {
		root, err := canonicalDirectory(m.storageRoot)
		if err != nil {
			return "", err
		}
		if requestedPath == "" {
			return "", ErrPathRequired
		}
		target := requestedPath
		if !filepath.IsAbs(target) {
			target = filepath.Join(root, target)
		}
		resolved, err := canonicalDirectory(target)
		if err != nil {
			return "", err
		}
		relative, err := filepath.Rel(root, resolved)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return "", ErrVaultMismatch
		}
		return resolved, nil
	}
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
	err := m.context.close()
	m.context = nil
	return err
}

func (c *Context) close() error {
	if c.cancel != nil {
		c.cancel()
	}
	var err error
	if c.Watch != nil {
		err = c.Watch.Close()
	}
	c.indexing.Wait()
	if c.Index != nil {
		if closeErr := c.Index.Close(); err == nil {
			err = closeErr
		}
	}
	return err
}

func (c *Context) runIndexer(ctx context.Context) {
	defer c.indexing.Done()
	c.reconcile(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case events := <-c.jobs:
			c.processEvents(ctx, events)
			if c.dirty.Swap(false) {
				c.reconcile(ctx)
			}
		}
	}
}

func (c *Context) reconcile(ctx context.Context) {
	for {
		c.dirty.Store(false)
		if !c.reconcilePass(ctx) || !c.dirty.Swap(false) {
			return
		}
	}
}

func (c *Context) reconcilePass(ctx context.Context) bool {
	c.setLifecycle(domain.VaultStateIndexing, &domain.IndexingProgress{Phase: "scanning"})
	entries, err := c.Files.List()
	if err != nil {
		c.degrade()
		return false
	}
	progress := domain.IndexingProgress{Phase: "indexing", Total: len(entries)}
	c.setLifecycle(domain.VaultStateIndexing, &progress)
	fingerprints, err := c.Index.Fingerprints()
	if err != nil {
		c.degrade()
		return false
	}
	const indexBatchSize = 100
	batch := make([]index.PreparedFile, 0, indexBatchSize)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		if err := c.Index.IndexPrepared(batch); err != nil {
			progress.Failed += len(batch)
		}
		batch = batch[:0]
	}
	for _, entry := range entries {
		select {
		case <-ctx.Done():
			return false
		case events := <-c.jobs:
			c.processEvents(ctx, events)
		default:
		}
		if fingerprint, exists := fingerprints[entry.Path]; !exists || !fingerprint.Current(entry) {
			prepared, err := c.prepareEntry(entry)
			if err != nil {
				progress.Failed++
			} else {
				batch = append(batch, prepared)
				if len(batch) == cap(batch) {
					flush()
				}
			}
		}
		progress.Processed++
		if progress.Processed%100 == 0 || progress.Processed == progress.Total {
			copy := progress
			c.setLifecycle(domain.VaultStateIndexing, &copy)
		}
	}
	flush()
	if err := c.Index.DeleteMissing(entries); err != nil {
		progress.Failed++
	}
	if progress.Failed > 0 || c.broken.Load() {
		c.degrade()
		c.publish([]watcherRuntime.Event{{Op: watcherRuntime.OpReconcile}})
		return false
	}
	c.setLifecycle(domain.VaultStateActive, nil)
	c.publish([]watcherRuntime.Event{{Op: watcherRuntime.OpReconcile}})
	return true
}

func (c *Context) prepareEntry(entry domain.FileEntry) (index.PreparedFile, error) {
	if entry.Kind == domain.FileKindDirectory {
		return index.PrepareFile(entry, nil)
	}
	file, err := os.Open(filepath.Join(c.root, filepath.FromSlash(entry.Path)))
	if err != nil {
		return index.PreparedFile{}, err
	}
	defer file.Close()
	return index.PrepareFile(entry, file)
}

func (c *Context) processEvents(ctx context.Context, events []watcherRuntime.Event) {
	for _, event := range events {
		if ctx.Err() != nil {
			return
		}
		if event.Op == watcherRuntime.OpReconcile {
			c.dirty.Store(true)
			continue
		}
		if event.Op == watcherRuntime.OpRemove {
			if err := c.Index.DeletePath(event.Path); err != nil {
				c.broken.Store(true)
				c.degrade()
			}
			continue
		}
		if err := c.indexPath(event.Path, true); err != nil && !errors.Is(err, os.ErrNotExist) {
			c.broken.Store(true)
			c.degrade()
		}
	}
}

func (c *Context) indexPath(relative string, force bool) error {
	relative = filepath.ToSlash(filepath.Clean(relative))
	if relative == "." || relative == ".." || strings.HasPrefix(relative, "../") || files.IsIgnored(relative) {
		return nil
	}
	absolute := filepath.Join(c.root, filepath.FromSlash(relative))
	info, err := os.Lstat(absolute)
	if errors.Is(err, os.ErrNotExist) {
		return c.Index.DeletePath(relative)
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil
	}
	if !info.IsDir() {
		if !files.IsSupportedVaultFile(relative) {
			return c.Index.DeletePath(relative)
		}
		return c.indexEntry(entryFor(relative, info), force)
	}
	return filepath.WalkDir(absolute, func(current string, dir fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(c.root, current)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if files.IsIgnored(rel) {
			if dir.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if dir.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if !dir.IsDir() && !files.IsSupportedVaultFile(rel) {
			return nil
		}
		stat, err := dir.Info()
		if err != nil {
			return err
		}
		return c.indexEntry(entryFor(rel, stat), force)
	})
}

func (c *Context) indexEntry(entry domain.FileEntry, force bool) error {
	if !force {
		current, err := c.Index.IsCurrent(entry)
		if err != nil || current {
			return err
		}
	}
	if entry.Kind == domain.FileKindDirectory {
		return c.Index.IndexFile(entry, nil)
	}
	file, err := os.Open(filepath.Join(c.root, filepath.FromSlash(entry.Path)))
	if err != nil {
		return err
	}
	defer file.Close()
	return c.Index.IndexFile(entry, io.Reader(file))
}

func (c *Context) QueueIndex(path string) {
	if c.Index == nil {
		return
	}
	c.queue([]watcherRuntime.Event{{Path: path, Op: watcherRuntime.OpWrite}})
}

func (c *Context) QueueDelete(path string) {
	if c.Index == nil {
		return
	}
	c.queue([]watcherRuntime.Event{{Path: path, Op: watcherRuntime.OpRemove}})
}

func (c *Context) RebuildIndex() error {
	if c.Index == nil {
		return errors.New("vault index is unavailable")
	}
	if err := c.Index.Reset(); err != nil {
		return err
	}
	c.broken.Store(false)
	c.queue([]watcherRuntime.Event{{Op: watcherRuntime.OpReconcile}})
	return nil
}

func (c *Context) FileMetadata(relative string) (domain.FileEntry, error) {
	return c.Files.Metadata(relative)
}

func entryFor(relative string, info os.FileInfo) domain.FileEntry {
	extension := strings.ToLower(filepath.Ext(relative))
	kind := domain.FileKindBinary
	if info.IsDir() {
		kind = domain.FileKindDirectory
	} else if extension == ".md" {
		kind = domain.FileKindMarkdown
	}
	return domain.FileEntry{Path: relative, Name: path.Base(relative), Kind: kind, SizeBytes: info.Size(), ModifiedAt: info.ModTime()}
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
