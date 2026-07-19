package app

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/flux-pkm/server/internal/vault"
)

func TestVaultFileLifecycle(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "Welcome.md"), []byte("# Welcome\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	manager := vault.NewManager(root, false)
	t.Cleanup(func() { _ = manager.Close() })
	service := NewService(manager)

	if service.Status().OpenVault != nil {
		t.Fatal("server opened the configured vault during startup")
	}
	if _, err := os.Stat(filepath.Join(root, ".flux")); !os.IsNotExist(err) {
		t.Fatalf("vault was mutated before OpenVault: %v", err)
	}

	info, err := service.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	entries, err := service.ListFiles(info.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Path != "Welcome.md" {
		t.Fatalf("unexpected files: %#v", entries)
	}

	document, err := service.ReadFile(info.ID, "Welcome.md")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.SaveFile(info.ID, "Welcome.md", "# Updated\n", document.ContentHash)
	if err != nil {
		t.Fatal(err)
	}
	if result.ContentHash == document.ContentHash {
		t.Fatal("save did not return a new content hash")
	}
	content, err := os.ReadFile(filepath.Join(root, "Welcome.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "# Updated\n" {
		t.Fatalf("canonical file was not updated: %q", content)
	}
	for _, derivedPath := range []string{"vault.json", "index.db"} {
		if _, err := os.Stat(filepath.Join(root, ".flux", derivedPath)); err != nil {
			t.Fatalf("missing derived vault state %s: %v", derivedPath, err)
		}
	}
}

func TestIndexFailureDoesNotBlockVaultFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "Welcome.md"), []byte("# Welcome\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".flux", "index.db"), 0o700); err != nil {
		t.Fatal(err)
	}

	manager := vault.NewManager(root, false)
	t.Cleanup(func() { _ = manager.Close() })
	service := NewService(manager)
	info, err := service.OpenVault("")
	if err != nil {
		t.Fatal(err)
	}
	if info.State != "degraded" || service.Status().Status != "degraded" {
		t.Fatalf("index failure not reported as degraded: %#v", service.Status())
	}
	entries, err := service.ListFiles(info.ID)
	if err != nil || len(entries) != 1 || entries[0].Path != "Welcome.md" {
		t.Fatalf("canonical files unavailable after index failure: %#v, %v", entries, err)
	}
}
