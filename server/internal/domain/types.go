package domain

import "time"

type VaultState string

const (
	VaultStateInitializing VaultState = "initializing"
	VaultStateReady        VaultState = "ready"
	VaultStateDegraded     VaultState = "degraded"
)

type TextEdit struct {
	StartByte int    `json:"startByte"`
	EndByte   int    `json:"endByte"`
	Text      string `json:"text"`
}

type VaultInfo struct {
	ID    string     `json:"id"`
	Name  string     `json:"name"`
	State VaultState `json:"state"`
}

type FileKind string

const (
	FileKindDirectory FileKind = "directory"
	FileKindMarkdown  FileKind = "markdown"
	FileKindText      FileKind = "text"
	FileKindBinary    FileKind = "binary"
)

type FileEntry struct {
	Path       string    `json:"path"`
	Name       string    `json:"name"`
	Kind       FileKind  `json:"kind"`
	SizeBytes  int64     `json:"sizeBytes"`
	ModifiedAt time.Time `json:"modifiedAt"`
}

type FileDocument struct {
	Path        string    `json:"path"`
	Content     string    `json:"content"`
	ContentHash string    `json:"contentHash"`
	ModifiedAt  time.Time `json:"modifiedAt"`
}

type SaveResult struct {
	Path        string    `json:"path"`
	ContentHash string    `json:"contentHash"`
	ModifiedAt  time.Time `json:"modifiedAt"`
}

type TrashEntry struct {
	ID           string    `json:"id"`
	OriginalPath string    `json:"originalPath"`
	DeletedAt    time.Time `json:"deletedAt"`
	SizeBytes    int64     `json:"sizeBytes"`
}

type PurgeResult struct {
	Deleted int `json:"deleted"`
}

type ServerStatus struct {
	Status          string     `json:"status"`
	Version         string     `json:"version"`
	VaultConfigured bool       `json:"vaultConfigured"`
	OpenVault       *VaultInfo `json:"openVault"`
}
