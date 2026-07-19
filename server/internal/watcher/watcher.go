package watcher

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/flux-pkm/server/internal/files"
	"github.com/fsnotify/fsnotify"
)

const debounce = 250 * time.Millisecond
const reconciliationInterval = 5 * time.Minute

type Watcher struct {
	inner    *fsnotify.Watcher
	root     string
	onChange func()
	done     chan struct{}
	close    sync.Once
	wait     sync.WaitGroup
}

func Start(root string, onChange func()) (*Watcher, error) {
	inner, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	watcher := &Watcher{inner: inner, root: root, onChange: onChange, done: make(chan struct{})}
	if err := watcher.addTree(root); err != nil {
		inner.Close()
		return nil, err
	}
	watcher.wait.Add(1)
	go watcher.run()
	return watcher, nil
}

func (w *Watcher) Close() error {
	w.close.Do(func() { close(w.done) })
	w.wait.Wait()
	return w.inner.Close()
}

func (w *Watcher) run() {
	defer w.wait.Done()
	reconcile := time.NewTicker(reconciliationInterval)
	defer reconcile.Stop()
	var timer *time.Timer
	var timerChannel <-chan time.Time
	for {
		select {
		case event, ok := <-w.inner.Events:
			if !ok {
				return
			}
			if w.ignored(event.Name) {
				continue
			}
			if event.Has(fsnotify.Create) {
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
					_ = w.addTree(event.Name)
				}
			}
			if timer == nil {
				timer = time.NewTimer(debounce)
			} else {
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(debounce)
			}
			timerChannel = timer.C
		case <-timerChannel:
			timerChannel = nil
			w.onChange()
		case _, ok := <-w.inner.Errors:
			if !ok {
				return
			}
			w.onChange()
		case <-reconcile.C:
			w.onChange()
		case <-w.done:
			if timer != nil {
				timer.Stop()
			}
			return
		}
	}
}

func (w *Watcher) addTree(root string) error {
	return filepath.WalkDir(root, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if current != w.root && w.ignored(current) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return w.inner.Add(current)
		}
		return nil
	})
}

func (w *Watcher) ignored(current string) bool {
	relative, err := filepath.Rel(w.root, current)
	if err != nil || relative == ".." {
		return true
	}
	if relative == "." {
		return false
	}
	base := filepath.Base(relative)
	if strings.HasPrefix(base, ".flux-write-") || strings.HasPrefix(base, ".flux-rename-") ||
		strings.HasSuffix(base, ".swp") || strings.HasSuffix(base, "~") || base == ".DS_Store" {
		return true
	}
	return files.IsInternal(filepath.ToSlash(relative))
}
