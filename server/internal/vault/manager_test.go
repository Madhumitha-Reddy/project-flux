package vault

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestDevelopmentManagerOpensAndSwitchesRequestedVaults(t *testing.T) {
	firstRoot := t.TempDir()
	secondRoot := t.TempDir()
	manager := NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })

	first, err := manager.Open(firstRoot)
	if err != nil {
		t.Fatal(err)
	}
	second, err := manager.Open(secondRoot)
	if err != nil {
		t.Fatal(err)
	}
	if first.VaultInfo().ID == second.VaultInfo().ID {
		t.Fatal("switch kept previous vault identity")
	}
	for _, root := range []string{firstRoot, secondRoot} {
		if _, err := os.Stat(filepath.Join(root, ".flux", "vault.json")); err != nil {
			t.Fatalf("vault was not initialized at %s: %v", root, err)
		}
	}
}

func TestServerWithoutConfiguredRootRejectsArbitraryPaths(t *testing.T) {
	manager := NewManager("", false)
	if _, err := manager.Open(t.TempDir()); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("expected ErrNotConfigured, got %v", err)
	}
}

func TestCreateInitializesVaultAndRejectsNestedVault(t *testing.T) {
	root := filepath.Join(t.TempDir(), "new-vault")
	manager := NewManager("", true)
	t.Cleanup(func() { _ = manager.Close() })

	created, err := manager.Create(root)
	if err != nil {
		t.Fatal(err)
	}
	if created.VaultInfo().ID == "" {
		t.Fatal("created vault has no identity")
	}
	for _, name := range []string{"vault.json", "index.db"} {
		if _, err := os.Stat(filepath.Join(root, ".flux", name)); err != nil {
			t.Fatalf("vault metadata %s was not created: %v", name, err)
		}
	}
	if _, err := manager.Create(filepath.Join(root, "nested")); !errors.Is(err, ErrNestedVault) {
		t.Fatalf("expected ErrNestedVault, got %v", err)
	}
}
