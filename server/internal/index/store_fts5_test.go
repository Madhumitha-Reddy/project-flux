//go:build sqlite_fts5

package index

import "testing"

func TestProductionBuildEnablesFTS5(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if !store.ftsEnabled {
		t.Fatal("sqlite_fts5 build must expose FTS5")
	}
}
