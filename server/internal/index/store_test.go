package index

import (
	"path"
	"strings"
	"testing"
	"time"

	"github.com/flux-pkm/server/internal/domain"
)

func TestIndexFileTracksHashesAndInvalidatesChangedMetadata(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	entry := domain.FileEntry{Path: "note.md", Name: "note.md", Kind: domain.FileKindMarkdown, SizeBytes: 5, ModifiedAt: time.Now().UTC()}
	if err := store.IndexFile(entry, strings.NewReader("hello")); err != nil {
		t.Fatal(err)
	}
	current, err := store.IsCurrent(entry)
	if err != nil || !current {
		t.Fatalf("indexed file not current: %v, %v", current, err)
	}
	entry.SizeBytes++
	entry.ModifiedAt = entry.ModifiedAt.Add(time.Second)
	if err := store.UpsertFile(entry); err != nil {
		t.Fatal(err)
	}
	current, err = store.IsCurrent(entry)
	if err != nil || current {
		t.Fatalf("changed file remained current: %v, %v", current, err)
	}
}

func TestIndexPreparedCommitsBatch(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	prepared := make([]PreparedFile, 0, 3)
	for _, name := range []string{"a.md", "b.md", "c.md"} {
		entry := domain.FileEntry{Path: name, Name: name, Kind: domain.FileKindMarkdown, SizeBytes: 4, ModifiedAt: time.Now().UTC()}
		file, err := PrepareFile(entry, strings.NewReader("note"))
		if err != nil {
			t.Fatal(err)
		}
		prepared = append(prepared, file)
	}
	if err := store.IndexPrepared(prepared); err != nil {
		t.Fatal(err)
	}
	entries, err := store.ListFiles()
	if err != nil || len(entries) != len(prepared) {
		t.Fatalf("unexpected indexed batch: %#v, %v", entries, err)
	}
}

func TestExtractLinksIgnoresMarkdownCodeExamples(t *testing.T) {
	content := "[[Visible]] `[[Inline]]`\n```md\n[[Fenced]]\n[also fenced](Hidden.md)\n```\n~~~\n[[Tilde fenced]]\n~~~\n[Real](Real.md)"
	links := extractLinks(content)
	if len(links) != 2 || links[0].target != "Visible" || links[1].target != "Real.md" {
		t.Fatalf("code examples leaked into graph links: %#v", links)
	}
}

func TestDeletePathRemovesDirectoryDescendants(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	for _, path := range []string{"folder", "folder/a.md", "other.md"} {
		entry := domain.FileEntry{Path: path, Name: path, Kind: domain.FileKindMarkdown, ModifiedAt: time.Now().UTC()}
		if err := store.IndexFile(entry, strings.NewReader("")); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.DeletePath("folder"); err != nil {
		t.Fatal(err)
	}
	var paths []string
	if err := store.db.Model(&FileRecord{}).Order("relative_path").Pluck("relative_path", &paths).Error; err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 || paths[0] != "other.md" {
		t.Fatalf("unexpected remaining paths: %#v", paths)
	}
}

func TestResetClearsDerivedIndex(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	entry := domain.FileEntry{Path: "note.md", Name: "note.md", Kind: domain.FileKindMarkdown, SizeBytes: 4, ModifiedAt: time.Now().UTC()}
	if err := store.IndexFile(entry, strings.NewReader("note")); err != nil {
		t.Fatal(err)
	}
	if err := store.Reset(); err != nil {
		t.Fatal(err)
	}
	entries, err := store.ListFiles()
	if err != nil || len(entries) != 0 {
		t.Fatalf("derived index was not cleared: %#v, %v", entries, err)
	}
}

func TestGraphUsesPathsAndNeverCollapsesDuplicateNames(t *testing.T) {
	store, err := Open(t.TempDir() + "/index.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now().UTC()
	inputs := []struct {
		path, content string
		kind          domain.FileKind
	}{
		{"notes/start.md", "[[../one/route.md]] [[route]] [[target]] [[Not created]]", domain.FileKindMarkdown},
		{"notes/target.md", "target", domain.FileKindMarkdown},
		{"one/route.md", "one", domain.FileKindMarkdown},
		{"two/route.md", "two", domain.FileKindMarkdown},
		{"src/ignored.ts", "export const ignored = true", domain.FileKindText},
	}
	for _, input := range inputs {
		entry := domain.FileEntry{Path: input.path, Name: path.Base(input.path), Kind: input.kind, SizeBytes: int64(len(input.content)), ModifiedAt: now}
		if err := store.IndexFile(entry, strings.NewReader(input.content)); err != nil {
			t.Fatal(err)
		}
	}
	graph, err := store.Graph()
	if err != nil {
		t.Fatal(err)
	}
	if len(graph.Nodes) != 6 {
		t.Fatalf("duplicate paths collapsed: %#v", graph.Nodes)
	}
	labels := map[string]string{}
	for _, node := range graph.Nodes {
		labels[node.Path] = node.Label
	}
	if labels["one/route.md"] != "route.md" || labels["two/route.md"] != "route.md" {
		t.Fatalf("duplicate nodes lost their display names: %#v", labels)
	}
	if _, exists := labels["src/ignored.ts"]; exists {
		t.Fatalf("code file leaked into knowledge graph: %#v", graph.Nodes)
	}
	edges := map[string]bool{}
	for _, edge := range graph.Edges {
		edges[edge.Source+"->"+edge.Target] = true
	}
	if !edges["notes/start.md->one/route.md"] || !edges["notes/start.md->notes/target.md"] {
		t.Fatalf("expected exact and relative graph edges: %#v", graph.Edges)
	}
	if edges["notes/start.md->two/route.md"] {
		t.Fatalf("ambiguous basename was silently resolved: %#v", graph.Edges)
	}
	if !edges["notes/start.md->missing:notes/Not created"] {
		t.Fatalf("unresolved links were not represented: %#v", graph.Edges)
	}
	missing := false
	for _, node := range graph.Nodes {
		if node.ID == "missing:notes/Not created" && node.Kind == "missing" && node.Path == "" {
			missing = true
		}
	}
	if !missing {
		t.Fatalf("missing graph node was not represented: %#v", graph.Nodes)
	}
}
