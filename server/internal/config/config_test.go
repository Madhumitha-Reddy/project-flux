package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	t.Setenv("ENVIRONMENT", "")
	t.Setenv("HOST", "")
	t.Setenv("FLUX_VAULT_PATH", "")
	t.Setenv("CORS_ALLOWED_ORIGIN", "")
	t.Setenv("PORT", "")

	cfg := Load()
	if cfg.Environment != "development" {
		t.Fatalf("expected development environment, got %q", cfg.Environment)
	}
	if cfg.Port != "8080" {
		t.Fatalf("expected port 8080, got %q", cfg.Port)
	}
	if cfg.Host != "127.0.0.1" {
		t.Fatalf("unexpected development host %q", cfg.Host)
	}
	if cfg.AllowedOrigin != "http://localhost:3000" {
		t.Fatalf("unexpected allowed origin %q", cfg.AllowedOrigin)
	}
	if cfg.VaultPath != "" {
		t.Fatalf("unexpected default vault path %q", cfg.VaultPath)
	}
}

func TestLoadEnvironment(t *testing.T) {
	t.Setenv("ENVIRONMENT", "test")
	t.Setenv("HOST", "0.0.0.0")
	t.Setenv("FLUX_VAULT_PATH", "/tmp/flux-vault")
	t.Setenv("CORS_ALLOWED_ORIGIN", "https://flux.example")
	t.Setenv("PORT", "9090")

	cfg := Load()
	if cfg.Environment != "test" || cfg.VaultPath != "/tmp/flux-vault" {
		t.Fatalf("environment values were not loaded: %#v", cfg)
	}
	if cfg.Host != "0.0.0.0" || cfg.Port != "9090" {
		t.Fatalf("runtime values were not loaded: %#v", cfg)
	}
	if cfg.AllowedOrigin != "https://flux.example" {
		t.Fatalf("unexpected allowed origin %q", cfg.AllowedOrigin)
	}
}
