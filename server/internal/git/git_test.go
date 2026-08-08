package git

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/flux-pkm/server/internal/domain"
)

func TestRepositoryFlow(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	if err := Enable(ctx, root); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".flux"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".flux", "index.db"), []byte("internal"), 0o644); err != nil {
		t.Fatal(err)
	}
	status, err := Status(ctx, root)
	if err != nil || !status.Available || !status.Initialized || len(status.Changes) != 2 {
		t.Fatalf("unexpected status: %#v, %v", status, err)
	}
	if err := Stage(ctx, root, []string{"note.md"}); err != nil {
		t.Fatal(err)
	}
	status, err = Status(ctx, root)
	if err != nil || changeStatus(status, "note.md") != "A" {
		t.Fatalf("file was not staged: %#v, %v", status, err)
	}
	if err := Unstage(ctx, root, []string{"note.md"}); err != nil {
		t.Fatal(err)
	}
	status, err = Status(ctx, root)
	if err != nil || changeStatus(status, "note.md") != "?" {
		t.Fatalf("file was not unstaged: %#v, %v", status, err)
	}
	ignored, err := os.ReadFile(filepath.Join(root, ".gitignore"))
	if err != nil || string(ignored) != ".flux/\n" {
		t.Fatalf("unexpected ignore file: %q, %v", ignored, err)
	}
}

func changeStatus(status domain.GitStatus, path string) string {
	for _, change := range status.Changes {
		if change.Path == path {
			return change.IndexStatus
		}
	}
	return ""
}

func TestRejectsOutsidePath(t *testing.T) {
	if _, err := pathArgs(nil, []string{"../outside"}); err != ErrInvalidPath {
		t.Fatalf("expected invalid path, got %v", err)
	}
	if _, err := pathArgs(nil, []string{".flux/index.db"}); err != ErrInvalidPath {
		t.Fatalf("expected internal path rejection, got %v", err)
	}
}
