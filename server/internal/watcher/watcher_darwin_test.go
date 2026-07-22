//go:build darwin

package watcher

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFSEventsRenameReportsOldAndNewPaths(t *testing.T) {
	root := t.TempDir()
	oldPath := filepath.Join(root, "old.md")
	if err := os.WriteFile(oldPath, []byte("note"), 0o600); err != nil {
		t.Fatal(err)
	}
	changed := make(chan []Event, 8)
	watcher, err := Start(root, func(events []Event) { changed <- events })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = watcher.Close() })
	if err := os.Rename(oldPath, filepath.Join(root, "new.md")); err != nil {
		t.Fatal(err)
	}

	seen := map[string]Op{}
	deadline := time.After(3 * time.Second)
	for seen["old.md"] != OpRemove || (seen["new.md"] != OpCreate && seen["new.md"] != OpWrite) {
		select {
		case events := <-changed:
			for _, event := range events {
				seen[event.Path] = event.Op
			}
		case <-deadline:
			t.Fatalf("rename events incomplete: %#v", seen)
		}
	}
}
