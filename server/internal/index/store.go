package index

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/flux-pkm/server/internal/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const MaxIndexedTextBytes int64 = 5 * 1024 * 1024

type FileRecord struct {
	ID           uint      `gorm:"primaryKey"`
	RelativePath string    `gorm:"uniqueIndex;not null"`
	DisplayName  string    `gorm:"not null"`
	Kind         string    `gorm:"not null"`
	SizeBytes    int64     `gorm:"not null"`
	ModifiedAt   time.Time `gorm:"not null"`
	ContentHash  string    `gorm:"not null;default:''"`
	IndexedHash  string    `gorm:"not null;default:''"`
	GraphIndexed bool      `gorm:"not null;default:false"`
	IndexedAt    *time.Time
}

func (FileRecord) TableName() string { return "files" }

type LinkRecord struct {
	ID         uint   `gorm:"primaryKey"`
	SourcePath string `gorm:"index;not null"`
	RawTarget  string `gorm:"not null"`
	Position   int    `gorm:"not null"`
}

func (LinkRecord) TableName() string { return "links" }

type Store struct {
	db         *gorm.DB
	writer     sync.Mutex
	ftsEnabled bool
}

type Fingerprint struct {
	SizeBytes    int64
	ModifiedAt   time.Time
	ContentHash  string
	IndexedHash  string
	GraphIndexed bool
}

// PreparedFile keeps file I/O outside the SQLite writer lock while allowing
// the background indexer to commit a bounded group of files together.
type PreparedFile struct {
	entry        domain.FileEntry
	contentHash  string
	searchText   string
	writableText bool
	indexedAt    time.Time
}

func (fingerprint Fingerprint) Current(entry domain.FileEntry) bool {
	return fingerprint.SizeBytes == entry.SizeBytes &&
		fingerprint.ModifiedAt.Equal(entry.ModifiedAt) &&
		fingerprint.ContentHash != "" &&
		fingerprint.ContentHash == fingerprint.IndexedHash &&
		fingerprint.GraphIndexed
}

func Open(databasePath string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o700); err != nil {
		return nil, err
	}
	db, err := gorm.Open(sqlite.Open(databasePath), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	store := &Store{db: db}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1)
	for _, pragma := range []string{
		"PRAGMA foreign_keys = ON",
		"PRAGMA journal_mode = WAL",
		"PRAGMA busy_timeout = 3000",
		"PRAGMA wal_autocheckpoint = 1000",
	} {
		if err := db.Exec(pragma).Error; err != nil {
			_ = store.Close()
			return nil, err
		}
	}
	if err := db.AutoMigrate(&FileRecord{}, &LinkRecord{}); err != nil {
		_ = store.Close()
		return nil, err
	}
	var fts5 int
	if db.Raw("SELECT sqlite_compileoption_used('ENABLE_FTS5')").Scan(&fts5).Error == nil && fts5 == 1 {
		store.ftsEnabled = db.Exec("CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(relative_path UNINDEXED, content)").Error == nil
	}
	return store, nil
}

// ReplaceFiles is reserved for explicit repair/rebuild paths.
func (s *Store) ReplaceFiles(entries []domain.FileEntry) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		paths := make([]string, 0, len(entries))
		for _, entry := range entries {
			paths = append(paths, entry.Path)
			if err := upsertMetadata(tx, entry); err != nil {
				return err
			}
		}
		return s.deleteMissing(tx, paths)
	})
}

func (s *Store) UpsertFile(entry domain.FileEntry) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return upsertMetadata(s.db, entry)
}

func (s *Store) ListFiles() ([]domain.FileEntry, error) {
	var records []FileRecord
	if err := s.db.Order("relative_path").Find(&records).Error; err != nil {
		return nil, err
	}
	entries := make([]domain.FileEntry, 0, len(records))
	for _, record := range records {
		entries = append(entries, domain.FileEntry{
			Path: record.RelativePath, Name: record.DisplayName, Kind: domain.FileKind(record.Kind),
			SizeBytes: record.SizeBytes, ModifiedAt: record.ModifiedAt,
		})
	}
	return entries, nil
}

func (s *Store) IsCurrent(entry domain.FileEntry) (bool, error) {
	var record FileRecord
	result := s.db.Where("relative_path = ?", entry.Path).Limit(1).Find(&record)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 0 {
		return false, nil
	}
	return record.SizeBytes == entry.SizeBytes && record.ModifiedAt.Equal(entry.ModifiedAt) &&
		record.ContentHash != "" && record.ContentHash == record.IndexedHash && record.GraphIndexed, nil
}

func (s *Store) Fingerprints() (map[string]Fingerprint, error) {
	var records []FileRecord
	if err := s.db.Select("relative_path", "size_bytes", "modified_at", "content_hash", "indexed_hash", "graph_indexed").Find(&records).Error; err != nil {
		return nil, err
	}
	fingerprints := make(map[string]Fingerprint, len(records))
	for _, record := range records {
		fingerprints[record.RelativePath] = Fingerprint{
			SizeBytes: record.SizeBytes, ModifiedAt: record.ModifiedAt,
			ContentHash: record.ContentHash, IndexedHash: record.IndexedHash,
			GraphIndexed: record.GraphIndexed,
		}
	}
	return fingerprints, nil
}

// IndexFile hashes full content while retaining searchable text only for bounded text files.
func (s *Store) IndexFile(entry domain.FileEntry, reader io.Reader) error {
	prepared, err := PrepareFile(entry, reader)
	if err != nil {
		return err
	}
	return s.IndexPrepared([]PreparedFile{prepared})
}

func PrepareFile(entry domain.FileEntry, reader io.Reader) (PreparedFile, error) {
	hasher := sha256.New()
	var text bytes.Buffer
	writableText := (entry.Kind == domain.FileKindMarkdown || entry.Kind == domain.FileKindText) && entry.SizeBytes <= MaxIndexedTextBytes
	var destination io.Writer = hasher
	if writableText {
		destination = io.MultiWriter(hasher, &text)
	}
	if reader != nil {
		if _, err := io.Copy(destination, reader); err != nil {
			return PreparedFile{}, err
		}
	}
	return PreparedFile{
		entry: entry, contentHash: hex.EncodeToString(hasher.Sum(nil)), searchText: text.String(),
		writableText: writableText, indexedAt: time.Now().UTC(),
	}, nil
}

func (s *Store) IndexPrepared(files []PreparedFile) error {
	if len(files) == 0 {
		return nil
	}
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		records := make([]FileRecord, 0, len(files))
		paths := make([]string, 0, len(files))
		type searchRow struct {
			RelativePath string `gorm:"column:relative_path"`
			Content      string `gorm:"column:content"`
		}
		searchRows := make([]searchRow, 0, len(files))
		links := make([]LinkRecord, 0)
		for _, file := range files {
			indexedAt := file.indexedAt
			records = append(records, FileRecord{
				RelativePath: file.entry.Path, DisplayName: file.entry.Name, Kind: string(file.entry.Kind),
				SizeBytes: file.entry.SizeBytes, ModifiedAt: file.entry.ModifiedAt,
				ContentHash: file.contentHash, IndexedHash: file.contentHash, IndexedAt: &indexedAt,
				GraphIndexed: true,
			})
			paths = append(paths, file.entry.Path)
			if file.writableText {
				searchRows = append(searchRows, searchRow{RelativePath: file.entry.Path, Content: file.searchText})
			}
			if file.entry.Kind == domain.FileKindMarkdown {
				for _, link := range extractLinks(file.searchText) {
					links = append(links, LinkRecord{SourcePath: file.entry.Path, RawTarget: link.target, Position: link.position})
				}
			}
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "relative_path"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"display_name", "kind", "size_bytes", "modified_at", "content_hash", "indexed_hash", "graph_indexed", "indexed_at",
			}),
		}).CreateInBatches(records, 100).Error; err != nil {
			return err
		}
		if err := tx.Where("source_path IN ?", paths).Delete(&LinkRecord{}).Error; err != nil {
			return err
		}
		if len(links) > 0 {
			if err := tx.CreateInBatches(links, 200).Error; err != nil {
				return err
			}
		}
		if !s.ftsEnabled {
			return nil
		}
		if err := tx.Exec("DELETE FROM files_fts WHERE relative_path IN ?", paths).Error; err != nil {
			return err
		}
		if len(searchRows) > 0 {
			return tx.Table("files_fts").CreateInBatches(searchRows, 100).Error
		}
		return nil
	})
}

func (s *Store) DeletePath(relativePath string) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	prefix := relativePath + "/"
	return s.db.Transaction(func(tx *gorm.DB) error {
		var paths []string
		if err := tx.Model(&FileRecord{}).
			Where("relative_path = ? OR substr(relative_path, 1, ?) = ?", relativePath, len(prefix), prefix).
			Pluck("relative_path", &paths).Error; err != nil {
			return err
		}
		if err := tx.Where("relative_path = ? OR substr(relative_path, 1, ?) = ?", relativePath, len(prefix), prefix).
			Delete(&FileRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Where("source_path = ? OR substr(source_path, 1, ?) = ?", relativePath, len(prefix), prefix).
			Delete(&LinkRecord{}).Error; err != nil {
			return err
		}
		return s.deleteFTS(tx, paths)
	})
}

func (s *Store) DeleteMissing(entries []domain.FileEntry) error {
	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		paths = append(paths, entry.Path)
	}
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		return s.deleteMissing(tx, paths)
	})
}

func (s *Store) deleteMissing(tx *gorm.DB, paths []string) error {
	if len(paths) == 0 {
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&FileRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&LinkRecord{}).Error; err != nil {
			return err
		}
		return s.clearFTS(tx)
	}
	if err := tx.Exec("DROP TABLE IF EXISTS temp.flux_live_paths").Error; err != nil {
		return err
	}
	if err := tx.Exec("CREATE TEMP TABLE flux_live_paths(path TEXT PRIMARY KEY)").Error; err != nil {
		return err
	}
	defer tx.Exec("DROP TABLE IF EXISTS temp.flux_live_paths")
	type livePath struct{ Path string }
	rows := make([]livePath, len(paths))
	for index, path := range paths {
		rows[index].Path = path
	}
	if err := tx.Table("flux_live_paths").CreateInBatches(rows, 500).Error; err != nil {
		return err
	}
	var stale []string
	if err := tx.Raw("SELECT relative_path FROM files WHERE NOT EXISTS (SELECT 1 FROM flux_live_paths WHERE path = files.relative_path)").Scan(&stale).Error; err != nil {
		return err
	}
	if err := tx.Exec("DELETE FROM files WHERE NOT EXISTS (SELECT 1 FROM flux_live_paths WHERE path = files.relative_path)").Error; err != nil {
		return err
	}
	if err := tx.Exec("DELETE FROM links WHERE NOT EXISTS (SELECT 1 FROM flux_live_paths WHERE path = links.source_path)").Error; err != nil {
		return err
	}
	return s.deleteFTS(tx, stale)
}

func (s *Store) Checkpoint() error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Exec("PRAGMA wal_checkpoint(PASSIVE)").Error
}

func (s *Store) Reset() error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&FileRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&LinkRecord{}).Error; err != nil {
			return err
		}
		return s.clearFTS(tx)
	})
}

func (s *Store) Close() error {
	_ = s.Checkpoint()
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

func (s *Store) clearFTS(db *gorm.DB) error {
	if !s.ftsEnabled {
		return nil
	}
	return db.Exec("DELETE FROM files_fts").Error
}

func (s *Store) deleteFTS(db *gorm.DB, paths []string) error {
	if !s.ftsEnabled || len(paths) == 0 {
		return nil
	}
	for start := 0; start < len(paths); start += 500 {
		end := min(start+500, len(paths))
		if err := db.Exec("DELETE FROM files_fts WHERE relative_path IN ?", paths[start:end]).Error; err != nil {
			return err
		}
	}
	return nil
}

func upsertMetadata(db *gorm.DB, entry domain.FileEntry) error {
	record := FileRecord{
		RelativePath: entry.Path, DisplayName: entry.Name, Kind: string(entry.Kind),
		SizeBytes: entry.SizeBytes, ModifiedAt: entry.ModifiedAt,
	}
	return db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "relative_path"}},
		DoUpdates: clause.Assignments(map[string]any{
			"display_name":  gorm.Expr("excluded.display_name"),
			"kind":          gorm.Expr("excluded.kind"),
			"content_hash":  gorm.Expr("CASE WHEN files.size_bytes != excluded.size_bytes OR files.modified_at != excluded.modified_at THEN '' ELSE files.content_hash END"),
			"indexed_hash":  gorm.Expr("CASE WHEN files.size_bytes != excluded.size_bytes OR files.modified_at != excluded.modified_at THEN '' ELSE files.indexed_hash END"),
			"graph_indexed": gorm.Expr("CASE WHEN files.size_bytes != excluded.size_bytes OR files.modified_at != excluded.modified_at THEN false ELSE files.graph_indexed END"),
			"indexed_at":    gorm.Expr("CASE WHEN files.size_bytes != excluded.size_bytes OR files.modified_at != excluded.modified_at THEN NULL ELSE files.indexed_at END"),
			"size_bytes":    gorm.Expr("excluded.size_bytes"),
			"modified_at":   gorm.Expr("excluded.modified_at"),
		}),
	}).Create(&record).Error
}

var (
	wikiLinkPattern     = regexp.MustCompile(`!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]`)
	markdownLinkPattern = regexp.MustCompile(`!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)`)
	externalLinkPattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9+.-]*:`)
)

type parsedLink struct {
	target   string
	position int
}

func extractLinks(content string) []parsedLink {
	masked := maskMarkdownCode(content)
	links := make([]parsedLink, 0)
	for _, pattern := range []*regexp.Regexp{wikiLinkPattern, markdownLinkPattern} {
		for _, match := range pattern.FindAllStringSubmatchIndex(masked, -1) {
			if len(match) >= 4 {
				links = append(links, parsedLink{target: strings.TrimSpace(content[match[2]:match[3]]), position: match[0]})
			}
		}
	}
	sort.Slice(links, func(i, j int) bool { return links[i].position < links[j].position })
	return links
}

// maskMarkdownCode preserves byte offsets while hiding inline and fenced code,
// matching Obsidian's rule that example links are not graph relationships.
func maskMarkdownCode(content string) string {
	masked := []byte(content)
	inFence := false
	fenceMarker := byte(0)
	for offset := 0; offset < len(masked); {
		lineLength := strings.IndexByte(content[offset:], '\n')
		lineEnd := len(masked)
		if lineLength >= 0 {
			lineEnd = offset + lineLength
		}
		trimmed := strings.TrimSpace(content[offset:lineEnd])
		isBacktickFence := strings.HasPrefix(trimmed, "```")
		isTildeFence := strings.HasPrefix(trimmed, "~~~")
		if (!inFence && (isBacktickFence || isTildeFence)) ||
			(inFence && ((fenceMarker == '`' && isBacktickFence) || (fenceMarker == '~' && isTildeFence))) {
			if !inFence {
				fenceMarker = trimmed[0]
			}
			blankBytes(masked[offset:lineEnd])
			inFence = !inFence
		} else if inFence {
			blankBytes(masked[offset:lineEnd])
		} else {
			inInline := false
			for index := offset; index < lineEnd; index++ {
				if content[index] == '`' {
					inInline = !inInline
					masked[index] = ' '
				} else if inInline {
					masked[index] = ' '
				}
			}
		}
		offset = lineEnd + 1
	}
	return string(masked)
}

func blankBytes(content []byte) {
	for index := range content {
		content[index] = ' '
	}
}

func normalizeLinkTarget(raw string) string {
	target := strings.Trim(strings.TrimSpace(raw), "<>")
	if decoded, err := url.PathUnescape(target); err == nil {
		target = decoded
	}
	if cut := strings.IndexAny(target, "?#"); cut >= 0 {
		target = target[:cut]
	}
	target = strings.ReplaceAll(target, `\`, "/")
	return path.Clean(target)
}

func extensionCandidates(target string) []string {
	if path.Ext(target) != "" {
		return []string{target}
	}
	return []string{target, target + ".md", target + ".markdown"}
}

// Graph returns a path-keyed snapshot. Resolution follows HLD priority and
// deliberately leaves duplicate filename targets unresolved.
func (s *Store) Graph() (domain.VaultGraph, error) {
	var records []FileRecord
	if err := s.db.Where("kind IN ?", []string{
		string(domain.FileKindMarkdown),
		string(domain.FileKindBinary),
	}).Order("relative_path").Find(&records).Error; err != nil {
		return domain.VaultGraph{}, err
	}
	byPath := make(map[string]FileRecord, len(records))
	byName := make(map[string][]string, len(records))
	for _, record := range records {
		byPath[record.RelativePath] = record
		name := strings.ToLower(record.DisplayName)
		byName[name] = append(byName[name], record.RelativePath)
		if record.Kind == string(domain.FileKindMarkdown) {
			stem := strings.ToLower(strings.TrimSuffix(strings.TrimSuffix(record.DisplayName, ".md"), ".markdown"))
			if stem != name {
				byName[stem] = append(byName[stem], record.RelativePath)
			}
		}
	}
	nodes := make([]domain.GraphNode, 0, len(records))
	for _, record := range records {
		label := record.DisplayName
		nodes = append(nodes, domain.GraphNode{ID: record.RelativePath, Path: record.RelativePath, Label: label, Kind: record.Kind})
	}
	var linkRecords []LinkRecord
	if err := s.db.Order("source_path, position").Find(&linkRecords).Error; err != nil {
		return domain.VaultGraph{}, err
	}
	edgeSet := make(map[string]domain.GraphEdge)
	missingNodes := make(map[string]domain.GraphNode)
	for _, link := range linkRecords {
		target := normalizeLinkTarget(link.RawTarget)
		if target == "" || target == "." || externalLinkPattern.MatchString(target) {
			continue
		}
		resolved := ""
		if !strings.HasPrefix(target, "../") {
			for _, candidate := range extensionCandidates(strings.TrimPrefix(target, "./")) {
				if _, ok := byPath[candidate]; ok {
					resolved = candidate
					break
				}
			}
		}
		if resolved == "" {
			relativeTarget := path.Join(path.Dir(link.SourcePath), target)
			if relativeTarget != ".." && !strings.HasPrefix(relativeTarget, "../") {
				for _, candidate := range extensionCandidates(relativeTarget) {
					if _, ok := byPath[candidate]; ok {
						resolved = candidate
						break
					}
				}
			}
		}
		if resolved == "" {
			matches := byName[strings.ToLower(path.Base(target))]
			if len(matches) == 1 {
				resolved = matches[0]
			}
		}
		if resolved != "" {
			key := link.SourcePath + "\n" + resolved
			edgeSet[key] = domain.GraphEdge{Source: link.SourcePath, Target: resolved}
			continue
		}
		missingTarget := path.Join(path.Dir(link.SourcePath), target)
		if strings.HasPrefix(target, "/") {
			missingTarget = strings.TrimPrefix(path.Clean(target), "/")
		}
		if missingTarget == ".." || strings.HasPrefix(missingTarget, "../") {
			continue
		}
		missingID := "missing:" + missingTarget
		label := path.Base(missingTarget)
		if label == "." || label == "/" || label == "" {
			label = target
		}
		missingNodes[missingID] = domain.GraphNode{ID: missingID, Label: label, Kind: "missing"}
		edgeSet[link.SourcePath+"\n"+missingID] = domain.GraphEdge{Source: link.SourcePath, Target: missingID}
	}
	for _, node := range missingNodes {
		nodes = append(nodes, node)
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].ID < nodes[j].ID })
	edges := make([]domain.GraphEdge, 0, len(edgeSet))
	for _, edge := range edgeSet {
		edges = append(edges, edge)
	}
	sort.Slice(edges, func(i, j int) bool {
		if edges[i].Source == edges[j].Source {
			return edges[i].Target < edges[j].Target
		}
		return edges[i].Source < edges[j].Source
	})
	return domain.VaultGraph{Nodes: nodes, Edges: edges}, nil
}
