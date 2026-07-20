package files

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/flux-pkm/server/internal/domain"
)

func TestServiceRejectsPathsOutsideVault(t *testing.T) {
	service := New(t.TempDir())
	for _, candidate := range []string{"../secret.md", ".flux/index.db", "/tmp/secret.md"} {
		if _, err := service.Read(candidate); !errors.Is(err, ErrInvalidPath) {
			t.Fatalf("expected %q to be rejected, got %v", candidate, err)
		}
	}
}

func TestListHidesMacMetadata(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".DS_Store"), []byte("junk"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("note"), 0o600); err != nil {
		t.Fatal(err)
	}
	entries, err := New(root).List()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Path != "note.md" {
		t.Fatalf("unexpected visible entries: %#v", entries)
	}
}

func TestListIgnoresHeavyDirectoriesAtAnyDepth(t *testing.T) {
	root := t.TempDir()
	for _, candidate := range []string{
		"node_modules/top.md",
		"packages/app/node_modules/nested.md",
		"packages/app/.cache/cached.md",
		"packages/app/dist/output.md",
		"packages/app/src/visible.md",
	} {
		path := filepath.Join(root, filepath.FromSlash(candidate))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(candidate), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	entries, err := New(root).List()
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if IsIgnored(entry.Path) {
			t.Fatalf("ignored entry leaked into listing: %s", entry.Path)
		}
	}
	found := false
	for _, entry := range entries {
		if entry.Path == "packages/app/src/visible.md" {
			found = true
		}
	}
	if !found {
		t.Fatal("visible source file missing")
	}
}

func TestSaveUsesExpectedHash(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "note.md")
	if err := os.WriteFile(filePath, []byte("base"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := New(root)
	document, err := service.Read("note.md")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filePath, []byte("external edit"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Save("note.md", "my edit", document.ContentHash); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected a conflict, got %v", err)
	}
	content, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "external edit" {
		t.Fatalf("conflicting save overwrote disk content: %q", content)
	}
}

func TestSaveRefusesBlindOverwrite(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "note.md")
	if err := os.WriteFile(filePath, []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := New(root).Save("note.md", "overwrite", ""); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected a conflict, got %v", err)
	}
}

func TestSavePreservesPermissions(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "note.md")
	if err := os.WriteFile(filePath, []byte("before"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filePath, 0o640); err != nil {
		t.Fatal(err)
	}
	service := New(root)
	document, err := service.Read("note.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Save("note.md", "after", document.ContentHash); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o640 {
		t.Fatalf("permissions changed to %o", info.Mode().Perm())
	}
}

func TestMutationLifecycle(t *testing.T) {
	root := t.TempDir()
	service := New(root)
	if _, err := service.CreateDirectory("notes/inbox"); err != nil {
		t.Fatal(err)
	}
	document, _, err := service.Create("notes/inbox/Draft.md", "hello world")
	if err != nil {
		t.Fatal(err)
	}
	patched, _, err := service.Patch("notes/inbox/Draft.md", document.ContentHash, []domain.TextEdit{{
		StartByte: 6,
		EndByte:   11,
		Text:      "Flux",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Move("notes/inbox/Draft.md", "notes/Welcome.md"); err != nil {
		t.Fatal(err)
	}
	trashed, err := service.Delete("notes/Welcome.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "notes", "Welcome.md")); !os.IsNotExist(err) {
		t.Fatalf("deleted file still exists: %v", err)
	}
	if _, err := service.Restore(trashed.ID); err != nil {
		t.Fatal(err)
	}
	restored, err := service.Read("notes/Welcome.md")
	if err != nil {
		t.Fatal(err)
	}
	if restored.Content != "hello Flux" || restored.ContentHash != patched.ContentHash {
		t.Fatalf("unexpected restored document: %#v", restored)
	}
}

func TestPatchRejectsInvalidUTF8Boundary(t *testing.T) {
	root := t.TempDir()
	service := New(root)
	document, _, err := service.Create("unicode.md", "a😀b")
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = service.Patch("unicode.md", document.ContentHash, []domain.TextEdit{{
		StartByte: 2,
		EndByte:   5,
		Text:      "x",
	}})
	if !errors.Is(err, ErrInvalidEdit) {
		t.Fatalf("expected invalid edit, got %v", err)
	}
}

func TestTrashListPurgeAndPermanentDelete(t *testing.T) {
	root := t.TempDir()
	service := New(root)
	if _, _, err := service.Create("old.md", strings.Repeat("x", 12)); err != nil {
		t.Fatal(err)
	}
	old, err := service.Delete("old.md")
	if err != nil {
		t.Fatal(err)
	}
	old.DeletedAt = time.Now().UTC().Add(-31 * 24 * time.Hour)
	metadata, _ := json.Marshal(old)
	if err := os.WriteFile(filepath.Join(root, ".flux", "trash", old.ID, "metadata.json"), metadata, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Create("recent.md", "recent"); err != nil {
		t.Fatal(err)
	}
	recent, err := service.Delete("recent.md")
	if err != nil {
		t.Fatal(err)
	}

	entries, err := service.ListTrash()
	if err != nil || len(entries) != 2 || entries[0].ID != recent.ID || old.SizeBytes != 12 {
		t.Fatalf("unexpected trash listing: %#v, %v", entries, err)
	}
	deleted, err := service.PurgeTrash(30*24*time.Hour, time.Now().UTC())
	if err != nil || deleted != 1 {
		t.Fatalf("unexpected purge result: %d, %v", deleted, err)
	}
	if err := service.PermanentlyDelete(recent.ID); err != nil {
		t.Fatal(err)
	}
	entries, err = service.ListTrash()
	if err != nil || len(entries) != 0 {
		t.Fatalf("trash was not emptied: %#v, %v", entries, err)
	}
}

func TestMoveRewritesOnlyResolvedLinks(t *testing.T) {
	root := t.TempDir()
	service := New(root)
	for _, directory := range []string{"one", "two", "folder", "nested"} {
		if _, err := service.CreateDirectory(directory); err != nil {
			t.Fatal(err)
		}
	}
	for path, content := range map[string]string{
		"Target.md":        "target",
		"one/Dup.md":       "one",
		"two/Dup.md":       "two",
		"Backlinks.md":     "[[Target#Heading|label]] [target](Target.md#Heading) [[Dup]] [[Missing]] `[[Target]]`\n```\n[[Target]]\n```\n",
		"folder/Source.md": "[[../Target]] [target](../Target.md)",
	} {
		if _, _, err := service.Create(path, content); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := service.Move("Target.md", "Renamed.md"); err != nil {
		t.Fatal(err)
	}
	backlinks, err := service.Read("Backlinks.md")
	if err != nil {
		t.Fatal(err)
	}
	expected := "[[Renamed#Heading|label]] [target](Renamed.md#Heading) [[Dup]] [[Missing]] `[[Target]]`\n```\n[[Target]]\n```\n"
	if backlinks.Content != expected {
		t.Fatalf("unexpected rewritten backlinks:\n%s", backlinks.Content)
	}

	if _, err := service.Move("folder", "nested/folder"); err != nil {
		t.Fatal(err)
	}
	source, err := service.Read("nested/folder/Source.md")
	if err != nil {
		t.Fatal(err)
	}
	if source.Content != "[[../../Renamed]] [target](../../Renamed.md)" {
		t.Fatalf("relative links were not preserved after move: %s", source.Content)
	}
}
