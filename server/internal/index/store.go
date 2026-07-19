package index

import (
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/flux-pkm/server/internal/domain"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FileRecord struct {
	ID           uint      `gorm:"primaryKey"`
	RelativePath string    `gorm:"uniqueIndex;not null"`
	DisplayName  string    `gorm:"not null"`
	Kind         string    `gorm:"not null"`
	SizeBytes    int64     `gorm:"not null"`
	ModifiedAt   time.Time `gorm:"not null"`
}

func (FileRecord) TableName() string { return "files" }

type Store struct {
	db     *gorm.DB
	writer sync.Mutex
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
	} {
		if err := db.Exec(pragma).Error; err != nil {
			_ = store.Close()
			return nil, err
		}
	}
	if err := db.AutoMigrate(&FileRecord{}); err != nil {
		_ = store.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) ReplaceFiles(entries []domain.FileEntry) error {
	s.writer.Lock()
	defer s.writer.Unlock()

	return s.db.Transaction(func(tx *gorm.DB) error {
		paths := make([]string, 0, len(entries))
		for _, entry := range entries {
			paths = append(paths, entry.Path)
			if err := upsert(tx, entry); err != nil {
				return err
			}
		}
		if len(paths) == 0 {
			return tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&FileRecord{}).Error
		}
		return tx.Where("relative_path NOT IN ?", paths).Delete(&FileRecord{}).Error
	})
}

func (s *Store) UpsertFile(entry domain.FileEntry) error {
	s.writer.Lock()
	defer s.writer.Unlock()
	return upsert(s.db, entry)
}

func (s *Store) Close() error {
	sqlDB, err := s.db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

func upsert(db *gorm.DB, entry domain.FileEntry) error {
	record := FileRecord{
		RelativePath: entry.Path,
		DisplayName:  entry.Name,
		Kind:         string(entry.Kind),
		SizeBytes:    entry.SizeBytes,
		ModifiedAt:   entry.ModifiedAt,
	}
	return db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "relative_path"}},
		DoUpdates: clause.AssignmentColumns([]string{"display_name", "kind", "size_bytes", "modified_at"}),
	}).Create(&record).Error
}
