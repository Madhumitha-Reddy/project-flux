package modelproviders

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/flux-pkm/server/internal/domain"
)

var (
	ErrProviderNotFound = errors.New("model provider not found")
	ErrInvalidConfig    = errors.New("invalid provider config")
)

type Service struct {
	configPath string
	mu         sync.RWMutex
	providers  map[string]domain.ModelProvider
	runtimes   map[string]domain.AIRuntime
}

func NewService(appDataDir string) (*Service, error) {
	configPath := filepath.Join(appDataDir, "model-providers.json")
	s := &Service{
		configPath: configPath,
		providers:  make(map[string]domain.ModelProvider),
		runtimes:   make(map[string]domain.AIRuntime),
	}
	
	if err := s.load(); err != nil {
		// If config doesn't exist, initialize with default providers
		if os.IsNotExist(err) {
			if err := s.initializeDefaults(); err != nil {
				return nil, fmt.Errorf("failed to initialize default providers: %w", err)
			}
		} else {
			return nil, fmt.Errorf("failed to load providers config: %w", err)
		}
	}
	
	return s, nil
}

func (s *Service) initializeDefaults() error {
	defaultProviders := []domain.ModelProvider{
		{
			ID:          "codex",
			Type:        domain.ModelProviderTypeCodex,
			Name:        "Codex",
			Description: "OpenAI Codex integration",
			Enabled:     false,
			Config:      make(map[string]interface{}),
			Capabilities: []string{"chat", "streaming", "tool-calling", "external-agent-loop"},
		},
		{
			ID:          "copilot",
			Type:        domain.ModelProviderTypeCopilot,
			Name:        "GitHub Copilot",
			Description: "GitHub Copilot integration",
			Enabled:     false,
			Config:      make(map[string]interface{}),
			Capabilities: []string{"chat", "streaming", "tool-calling"},
		},
		{
			ID:          "opencode",
			Type:        domain.ModelProviderTypeOpenCode,
			Name:        "OpenCode",
			Description: "OpenCode integration",
			Enabled:     false,
			Config:      make(map[string]interface{}),
			Capabilities: []string{"chat", "streaming", "tool-calling"},
		},
		{
			ID:          "antigravity",
			Type:        domain.ModelProviderTypeAntigravity,
			Name:        "Antigravity CLI",
			Description: "Antigravity CLI integration",
			Enabled:     false,
			Config:      make(map[string]interface{}),
			Capabilities: []string{"chat", "streaming"},
		},
		{
			ID:          "ollama",
			Type:        domain.ModelProviderTypeOllama,
			Name:        "Ollama",
			Description: "Local Ollama instance",
			Enabled:     true,
			Config: map[string]interface{}{
				"url":    "http://localhost:11434",
				"model":  "llama3.2:1b",
			},
			Capabilities: []string{"chat", "streaming", "embeddings"},
		},
		{
			ID:          "lmstudio",
			Type:        domain.ModelProviderTypeLMStudio,
			Name:        "LM Studio",
			Description: "LM Studio local server",
			Enabled:     false,
			Config: map[string]interface{}{
				"url":   "http://localhost:1234",
				"model": "",
			},
			Capabilities: []string{"chat", "streaming"},
		},
	}
	
	s.mu.Lock()
	defer s.mu.Unlock()
	
	for _, provider := range defaultProviders {
		s.providers[provider.ID] = provider
	}
	
	return s.save()
}

func (s *Service) load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	content, err := os.ReadFile(s.configPath)
	if err != nil {
		return err
	}
	
	var config struct {
		Providers []domain.ModelProvider `json:"providers"`
		Runtimes  []domain.AIRuntime     `json:"runtimes"`
	}
	
	if err := json.Unmarshal(content, &config); err != nil {
		return err
	}
	
	s.providers = make(map[string]domain.ModelProvider)
	s.runtimes = make(map[string]domain.AIRuntime)
	
	for _, provider := range config.Providers {
		s.providers[provider.ID] = provider
	}
	
	for _, runtime := range config.Runtimes {
		s.runtimes[runtime.ID] = runtime
	}
	
	return nil
}

func (s *Service) save() error {
	config := struct {
		Providers []domain.ModelProvider `json:"providers"`
		Runtimes  []domain.AIRuntime     `json:"runtimes"`
	}{
		Providers: make([]domain.ModelProvider, 0, len(s.providers)),
		Runtimes:  make([]domain.AIRuntime, 0, len(s.runtimes)),
	}
	
	for _, provider := range s.providers {
		config.Providers = append(config.Providers, provider)
	}
	
	for _, runtime := range s.runtimes {
		config.Runtimes = append(config.Runtimes, runtime)
	}
	
	content, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	
	if err := os.MkdirAll(filepath.Dir(s.configPath), 0o755); err != nil {
		return err
	}
	
	return os.WriteFile(s.configPath, content, 0o644)
}

func (s *Service) ListProviders() []domain.ModelProvider {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	providers := make([]domain.ModelProvider, 0, len(s.providers))
	for _, provider := range s.providers {
		providers = append(providers, provider)
	}
	return providers
}

func (s *Service) GetProvider(id string) (domain.ModelProvider, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	provider, exists := s.providers[id]
	if !exists {
		return domain.ModelProvider{}, ErrProviderNotFound
	}
	return provider, nil
}

func (s *Service) UpdateProvider(id string, config map[string]interface{}) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	provider, exists := s.providers[id]
	if !exists {
		return ErrProviderNotFound
	}
	
	provider.Config = config
	s.providers[id] = provider
	
	return s.save()
}

func (s *Service) ListRuntimes() []domain.AIRuntime {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	runtimes := make([]domain.AIRuntime, 0, len(s.runtimes))
	for _, runtime := range s.runtimes {
		runtimes = append(runtimes, runtime)
	}
	return runtimes
}

func (s *Service) GetRuntime(id string) (domain.AIRuntime, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	runtime, exists := s.runtimes[id]
	if !exists {
		return domain.AIRuntime{}, ErrProviderNotFound
	}
	return runtime, nil
}
