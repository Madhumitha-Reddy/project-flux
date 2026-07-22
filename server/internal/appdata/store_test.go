package appdata

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
)

func TestStorePersistsBootstrapState(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "app.db")
	store, err := Open(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RememberVault("vault-1", "/tmp/notes", "Notes"); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveWorkspace("window-1", "vault-1", json.RawMessage(`{"tabs":["a.md"]}`)); err != nil {
		t.Fatal(err)
	}
	if err := store.PutSetting("theme", json.RawMessage(`"dark"`)); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	store, err = Open(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	bootstrap, err := store.Bootstrap("window-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(bootstrap.RecentVaults) != 1 || bootstrap.RecentVaults[0].VaultID != "vault-1" {
		t.Fatalf("unexpected recent vaults: %#v", bootstrap.RecentVaults)
	}
	if bootstrap.Workspace == nil || string(bootstrap.Workspace.State) != `{"tabs":["a.md"]}` {
		t.Fatalf("unexpected workspace: %#v", bootstrap.Workspace)
	}
	if bootstrap.Settings["theme"] != "dark" {
		t.Fatalf("unexpected settings: %#v", bootstrap.Settings)
	}
}

func TestStoreValidatesStateAndMissingWorkspace(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.SaveWorkspace("window", "vault", json.RawMessage(`{`)); err == nil {
		t.Fatal("expected invalid workspace JSON to fail")
	}
	if _, err := store.Workspace("missing", ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}
