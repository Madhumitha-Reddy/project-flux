package app

import (
	"context"
	"errors"
	"time"

	"github.com/flux-pkm/server/internal/domain"
	"github.com/flux-pkm/server/internal/files"
	"github.com/flux-pkm/server/internal/vault"
)

const Version = "0.0.1"

type Service struct {
	vaults *vault.Manager
}

func NewService(vaults *vault.Manager) *Service {
	return &Service{vaults: vaults}
}

func (s *Service) Status() domain.ServerStatus {
	status := domain.ServerStatus{
		Status:          "healthy",
		Version:         Version,
		VaultConfigured: s.vaults.Configured(),
	}
	if info := s.vaults.CurrentInfo(); info != nil {
		status.OpenVault = info
		if info.State == domain.VaultStateDegraded {
			status.Status = "degraded"
		}
	}
	return status
}

func (s *Service) OpenVault(path string) (domain.VaultInfo, error) {
	context, err := s.vaults.Open(path)
	if err != nil {
		return domain.VaultInfo{}, err
	}
	return context.VaultInfo(), nil
}

func (s *Service) CreateVault(path string) (domain.VaultInfo, error) {
	context, err := s.vaults.Create(path)
	if err != nil {
		return domain.VaultInfo{}, err
	}
	return context.VaultInfo(), nil
}

func (s *Service) ListFiles(vaultID string) ([]domain.FileEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return nil, err
	}
	entries, err := context.Files.List()
	if err != nil {
		return nil, err
	}
	if context.Index != nil {
		if err := context.Index.ReplaceFiles(entries); err != nil {
			s.vaults.Degrade(vaultID)
		}
	}
	return entries, nil
}

func (s *Service) VaultRevision(vaultID string) (uint64, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return 0, err
	}
	return context.Revision.Load(), nil
}

func (s *Service) WaitVaultRevision(ctx context.Context, vaultID string, after uint64) (uint64, error) {
	vaultContext, err := s.vaults.Get(vaultID)
	if err != nil {
		return 0, err
	}
	return vaultContext.WaitRevision(ctx, after), nil
}

func (s *Service) ReadFile(vaultID, path string) (domain.FileDocument, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.FileDocument{}, err
	}
	return context.Files.Read(path)
}

func (s *Service) CreateDirectory(vaultID, path string) (domain.FileEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.FileEntry{}, err
	}
	entry, err := context.Files.CreateDirectory(path)
	if err == nil {
		s.upsert(context, vaultID, entry)
	}
	return entry, err
}

func (s *Service) CreateFile(vaultID, path, content string) (domain.FileDocument, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.FileDocument{}, err
	}
	document, entry, err := context.Files.Create(path, content)
	if err == nil {
		s.upsert(context, vaultID, entry)
	}
	return document, err
}

func (s *Service) SaveFile(vaultID, path, content, expectedHash string) (domain.SaveResult, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.SaveResult{}, err
	}
	result, entry, err := context.Files.Save(path, content, expectedHash)
	if err != nil {
		return domain.SaveResult{}, err
	}
	s.upsert(context, vaultID, entry)
	return result, nil
}

func (s *Service) PatchFile(vaultID, path, expectedHash string, edits []domain.TextEdit) (domain.SaveResult, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.SaveResult{}, err
	}
	result, entry, err := context.Files.Patch(path, expectedHash, edits)
	if err == nil {
		s.upsert(context, vaultID, entry)
	}
	return result, err
}

func (s *Service) MoveFile(vaultID, sourcePath, destinationPath string) (domain.FileEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.FileEntry{}, err
	}
	entry, err := context.Files.Move(sourcePath, destinationPath)
	if errors.Is(err, files.ErrLinkRewrite) {
		s.vaults.Degrade(vaultID)
		s.reindex(context, vaultID)
		return entry, nil
	}
	if err == nil {
		s.reindex(context, vaultID)
	}
	return entry, err
}

func (s *Service) DeleteFile(vaultID, path string) (domain.TrashEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.TrashEntry{}, err
	}
	entry, err := context.Files.Delete(path)
	if err == nil {
		s.reindex(context, vaultID)
	}
	return entry, err
}

func (s *Service) RestoreFile(vaultID, trashID string) (domain.FileEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.FileEntry{}, err
	}
	entry, err := context.Files.Restore(trashID)
	if err == nil {
		s.reindex(context, vaultID)
	}
	return entry, err
}

func (s *Service) ListTrash(vaultID string) ([]domain.TrashEntry, error) {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return nil, err
	}
	return context.Files.ListTrash()
}

func (s *Service) PermanentlyDelete(vaultID, trashID string) error {
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return err
	}
	return context.Files.PermanentlyDelete(trashID)
}

func (s *Service) PurgeTrash(vaultID string, retentionDays int) (domain.PurgeResult, error) {
	if retentionDays != 7 && retentionDays != 30 && retentionDays != 90 {
		return domain.PurgeResult{}, files.ErrRetention
	}
	context, err := s.vaults.Get(vaultID)
	if err != nil {
		return domain.PurgeResult{}, err
	}
	deleted, err := context.Files.PurgeTrash(time.Duration(retentionDays)*24*time.Hour, time.Now().UTC())
	return domain.PurgeResult{Deleted: deleted}, err
}

func (s *Service) upsert(context *vault.Context, vaultID string, entry domain.FileEntry) {
	if context.Index != nil && context.Index.UpsertFile(entry) != nil {
		s.vaults.Degrade(vaultID)
	}
}

func (s *Service) reindex(context *vault.Context, vaultID string) {
	if context.Index == nil {
		return
	}
	// ponytail: full rescan favors correctness; replace with targeted watcher updates after large-vault benchmarks.
	entries, err := context.Files.List()
	if err != nil || context.Index.ReplaceFiles(entries) != nil {
		s.vaults.Degrade(vaultID)
	}
}
