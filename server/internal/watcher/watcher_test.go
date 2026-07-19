package watcher

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWatcherReportsExternalChange(t *testing.T) {
	root := t.TempDir()
	changed := make(chan struct{}, 1)
	watcher, err := Start(root, func() {
		select {
		case changed <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = watcher.Close() })
	if err := os.WriteFile(filepath.Join(root, "external.md"), []byte("changed"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-changed:
	case <-time.After(3 * time.Second):
		t.Fatal("watcher did not report external change")
	}
}

func TestWatcherAddsNewDirectoriesRecursively(t *testing.T) {
	root := t.TempDir()
	changed := make(chan struct{}, 4)
	watcher, err := Start(root, func() {
		select {
		case changed <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = watcher.Close() })
	directory := filepath.Join(root, "new", "nested")
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	select {
	case <-changed:
	case <-time.After(3 * time.Second):
		t.Fatal("watcher did not report new directory")
	}
	if err := os.WriteFile(filepath.Join(directory, "external.md"), []byte("changed"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-changed:
	case <-time.After(3 * time.Second):
		t.Fatal("watcher did not watch the new nested directory")
	}
}
