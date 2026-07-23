package plugins

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type testRuntime struct{ err error }

func (r testRuntime) ValidatePackage(context.Context, InstalledPlugin, Manifest) error { return r.err }

func TestPluginLifecycleAndRetainedVaultState(t *testing.T) {
	appData := t.TempDir()
	store, err := OpenMetadataStore(filepath.Join(appData, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	manager, err := NewManager(appData, store, testRuntime{})
	if err != nil {
		t.Fatal(err)
	}

	installOne := installTestPackage(t, manager, "1.0.0")
	if installOne.Plugin.Status != StatusStaged {
		t.Fatalf("expected staged plugin, got %q", installOne.Plugin.Status)
	}
	if err := manager.Activate(context.Background(), "example.plugin", "1.0.0"); err != nil {
		t.Fatal(err)
	}
	installTestPackage(t, manager, "1.1.0")
	if err := manager.Activate(context.Background(), "example.plugin", "1.1.0"); err != nil {
		t.Fatal(err)
	}
	active, err := store.Active("example.plugin")
	if err != nil {
		t.Fatal(err)
	}
	if active.ActiveVersion != "1.1.0" || active.PreviousVersion != "1.0.0" {
		t.Fatalf("unexpected active pointer: %#v", active)
	}
	if err := manager.Rollback(context.Background(), "example.plugin"); err != nil {
		t.Fatal(err)
	}
	active, err = store.Active("example.plugin")
	if err != nil || active.ActiveVersion != "1.0.0" {
		t.Fatalf("rollback failed: %#v, %v", active, err)
	}

	vault := t.TempDir()
	paths, err := EnsureVaultPaths(vault, "example.plugin")
	if err != nil {
		t.Fatal(err)
	}
	stateFile := filepath.Join(paths.State, "settings.json")
	if err := os.WriteFile(stateFile, []byte(`{"enabled":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := manager.Uninstall("example.plugin", "1.1.0"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stateFile); err != nil {
		t.Fatalf("per-vault state was removed: %v", err)
	}
	if err := manager.Uninstall("example.plugin", "1.0.0"); !errors.Is(err, ErrPluginActive) {
		t.Fatalf("expected active uninstall rejection, got %v", err)
	}
}

func TestActivationFailureDoesNotMoveActivePointer(t *testing.T) {
	appData := t.TempDir()
	store, err := OpenMetadataStore(filepath.Join(appData, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	manager, err := NewManager(appData, store, testRuntime{})
	if err != nil {
		t.Fatal(err)
	}
	installTestPackage(t, manager, "1.0.0")
	if err := manager.Activate(context.Background(), "example.plugin", "1.0.0"); err != nil {
		t.Fatal(err)
	}
	installTestPackage(t, manager, "2.0.0")
	manager.runtime = testRuntime{err: errors.New("sandbox rejected bundle")}
	if err := manager.Activate(context.Background(), "example.plugin", "2.0.0"); err == nil {
		t.Fatal("expected activation failure")
	}
	active, err := store.Active("example.plugin")
	if err != nil || active.ActiveVersion != "1.0.0" {
		t.Fatalf("active pointer moved after failure: %#v, %v", active, err)
	}
	failed, err := store.Version("example.plugin", "2.0.0")
	if err != nil || failed.Status != StatusFailed {
		t.Fatalf("failed version not recorded: %#v, %v", failed, err)
	}
}

func TestPackageValidationRejectsChecksumAndTraversal(t *testing.T) {
	appData := t.TempDir()
	store, err := OpenMetadataStore(filepath.Join(appData, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	manager, err := NewManager(appData, store, testRuntime{})
	if err != nil {
		t.Fatal(err)
	}
	archive := createTestPackage(t, "1.0.0", "../escape.js")
	checksum, err := checksumFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.InstallPackage(context.Background(), archive, "00"); !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("expected checksum rejection, got %v", err)
	}
	if _, err := manager.InstallPackage(context.Background(), archive, checksum); err == nil {
		t.Fatal("expected traversal rejection")
	}
	if _, err := os.Stat(filepath.Join(appData, "escape.js")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("archive escaped plugin root: %v", err)
	}
}

func TestConcurrentInstallAllowsOneWinner(t *testing.T) {
	appData := t.TempDir()
	store, err := OpenMetadataStore(filepath.Join(appData, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	manager, err := NewManager(appData, store, testRuntime{})
	if err != nil {
		t.Fatal(err)
	}
	archive := createTestPackage(t, "1.0.0", "dist/main.js")
	checksum, err := checksumFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	errorsSeen := make(chan error, 2)
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := manager.InstallPackage(context.Background(), archive, checksum)
			errorsSeen <- err
		}()
	}
	wait.Wait()
	close(errorsSeen)
	var succeeded, existed int
	for err := range errorsSeen {
		switch {
		case err == nil:
			succeeded++
		case errors.Is(err, ErrVersionExists):
			existed++
		default:
			t.Fatalf("unexpected install result: %v", err)
		}
	}
	if succeeded != 1 || existed != 1 {
		t.Fatalf("expected one winner and one existing result; got %d, %d", succeeded, existed)
	}
}

func TestManifestRejectsPermissionOverlap(t *testing.T) {
	manifest := testManifest("1.0.0")
	manifest.RequiredPermissions = []string{"vault.read"}
	manifest.OptionalPermissions = []string{"vault.read"}
	if err := manifest.Validate(); err == nil {
		t.Fatal("expected overlapping permission rejection")
	}
}

func TestManifestRejectsUnknownCapability(t *testing.T) {
	manifest := testManifest("1.0.0")
	manifest.RequiredPermissions = []string{"vault.root"}
	if err := manifest.Validate(); err == nil {
		t.Fatal("expected unsupported capability rejection")
	}
}

func TestRuntimePreflightRejectsAmbientNodeAPI(t *testing.T) {
	root := t.TempDir()
	entry := filepath.Join(root, "main.js")
	if err := os.WriteFile(entry, []byte(`const fs = require("fs")`), 0o600); err != nil {
		t.Fatal(err)
	}
	runtime := NewNodeSyntaxRuntime("node", time.Second)
	err := runtime.ValidatePackage(context.Background(), InstalledPlugin{InstallPath: root}, Manifest{Entry: "main.js"})
	if err == nil {
		t.Fatal("expected ambient Node API rejection")
	}
}

func TestVaultGrantRequiredAndExpandedUpdateNeedsApproval(t *testing.T) {
	appData := t.TempDir()
	store, err := OpenMetadataStore(filepath.Join(appData, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	manager, err := NewManager(appData, store, testRuntime{})
	if err != nil {
		t.Fatal(err)
	}
	installTestPackage(t, manager, "1.0.0")
	if err := manager.Activate(context.Background(), "example.plugin", "1.0.0"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.EnableForVault("vault-1", t.TempDir(), "example.plugin", nil); err == nil {
		t.Fatal("expected missing required permission rejection")
	}
	if _, err := manager.EnableForVault("vault-1", t.TempDir(), "example.plugin", []string{"vault.read"}); err != nil {
		t.Fatal(err)
	}

	updatedManifest := testManifest("2.0.0")
	updatedManifest.RequiredPermissions = []string{"vault.read", "vault.write"}
	archive := createPackageFromManifest(t, updatedManifest, "dist/main.js")
	checksum, err := checksumFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.InstallPackage(context.Background(), archive, checksum); err != nil {
		t.Fatal(err)
	}
	if err := manager.Activate(context.Background(), "example.plugin", "2.0.0"); !errors.Is(err, ErrPermissionApprovalNeeded) {
		t.Fatalf("expected update approval requirement, got %v", err)
	}
	if err := manager.ApproveUpdateForVault("vault-1", "example.plugin", "2.0.0", []string{"vault.read", "vault.write"}); err != nil {
		t.Fatal(err)
	}
	if err := manager.Activate(context.Background(), "example.plugin", "2.0.0"); err != nil {
		t.Fatal(err)
	}
	listed, err := store.ListForVault("vault-1")
	if err != nil || len(listed) != 1 || !listed[0].Enabled || len(listed[0].GrantedPermissions) != 2 {
		t.Fatalf("unexpected vault plugins: %#v, %v", listed, err)
	}
	if err := store.RecordVaultFailure("vault-1", "example.plugin", "boom", 2); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordVaultFailure("vault-1", "example.plugin", "boom again", 2); err != nil {
		t.Fatal(err)
	}
	listed, err = store.ListForVault("vault-1")
	if err != nil || listed[0].Enabled || listed[0].FailureCount != 2 {
		t.Fatalf("plugin was not auto-disabled: %#v, %v", listed, err)
	}
}

func TestPluginSettingsStayInsideVaultState(t *testing.T) {
	appData := t.TempDir()
	store, err := OpenMetadataStore(filepath.Join(appData, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	manager, err := NewManager(appData, store, testRuntime{})
	if err != nil {
		t.Fatal(err)
	}
	manifest := testManifest("1.0.0")
	manifest.Contributions.Settings = []SettingContribution{
		{ID: "example.plugin.label", Title: "Label", Type: "string", Default: json.RawMessage(`"hello"`)},
		{ID: "example.plugin.enabled", Title: "Enabled", Type: "boolean", Default: json.RawMessage(`true`)},
	}
	archive := createPackageFromManifest(t, manifest, manifest.Entry)
	checksum, err := checksumFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.InstallPackage(context.Background(), archive, checksum); err != nil {
		t.Fatal(err)
	}
	if err := manager.Activate(context.Background(), manifest.ID, manifest.Version); err != nil {
		t.Fatal(err)
	}
	vaultRoot := t.TempDir()
	values, err := manager.ReadSettings(vaultRoot, manifest.ID)
	if err != nil || values["example.plugin.label"] != "hello" {
		t.Fatalf("defaults missing: %#v, %v", values, err)
	}
	if err := manager.WriteSettings(vaultRoot, manifest.ID, map[string]any{
		"example.plugin.label": "changed",
	}); err != nil {
		t.Fatal(err)
	}
	values, err = manager.ReadSettings(vaultRoot, manifest.ID)
	if err != nil || values["example.plugin.label"] != "changed" || values["example.plugin.enabled"] != true {
		t.Fatalf("settings did not merge defaults: %#v, %v", values, err)
	}
	settingsPath := filepath.Join(vaultRoot, ".flux", "plugins", manifest.ID, "state", "settings.json")
	if _, err := os.Stat(settingsPath); err != nil {
		t.Fatal(err)
	}
}

func installTestPackage(t *testing.T, manager *Manager, version string) InstallResult {
	t.Helper()
	archive := createTestPackage(t, version, "dist/main.js")
	checksum, err := checksumFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	result, err := manager.InstallPackage(context.Background(), archive, checksum)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func createTestPackage(t *testing.T, version, entryName string) string {
	t.Helper()
	return createPackageFromManifest(t, testManifest(version), entryName)
}

func createPackageFromManifest(t *testing.T, manifest Manifest, entryName string) string {
	t.Helper()
	archivePath := filepath.Join(t.TempDir(), "plugin.zip")
	archiveFile, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(archiveFile)
	manifestBytes, err := jsonMarshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for name, contents := range map[string][]byte{
		ManifestFile: manifestBytes,
		entryName:    []byte("export function activate() {}"),
	} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(contents); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := archiveFile.Close(); err != nil {
		t.Fatal(err)
	}
	return archivePath
}

func testManifest(version string) Manifest {
	return Manifest{
		SchemaVersion: 1, ID: "example.plugin", Name: "Example", Version: version,
		APIVersion: "1", Entry: "dist/main.js", RequiredPermissions: []string{"vault.read"},
		ActivationEvents: []string{"onVaultOpen"},
	}
}

func jsonMarshal(value any) ([]byte, error) {
	return json.Marshal(value)
}
