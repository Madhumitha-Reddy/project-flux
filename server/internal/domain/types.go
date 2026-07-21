package domain

import "time"

type VaultState string

const (
	VaultStateInitializing  VaultState = "initializing"
	VaultStateReadOnlyReady VaultState = "read_only_ready"
	VaultStateWritable      VaultState = "writable"
	VaultStateIndexing      VaultState = "indexing"
	VaultStateActive        VaultState = "active"
	VaultStateDegraded      VaultState = "degraded"
)

type IndexingProgress struct {
	Phase     string `json:"phase"`
	Processed int    `json:"processed"`
	Total     int    `json:"total"`
	Failed    int    `json:"failed"`
}

type VaultFileEvent struct {
	Path string `json:"path"`
	Op   string `json:"op"`
}

type VaultChange struct {
	Revision  uint64           `json:"revision"`
	Events    []VaultFileEvent `json:"events,omitempty"`
	Reconcile bool             `json:"reconcile,omitempty"`
	Vault     VaultInfo        `json:"vault"`
}

type TextEdit struct {
	StartByte int    `json:"startByte"`
	EndByte   int    `json:"endByte"`
	Text      string `json:"text"`
}

type VaultInfo struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	State    VaultState        `json:"state"`
	Indexing *IndexingProgress `json:"indexing,omitempty"`
}

type VaultLocation struct {
	VaultID string `json:"vaultId,omitempty"`
	Name    string `json:"name"`
	Path    string `json:"path"`
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

type GraphNode struct {
	ID    string `json:"id"`
	Path  string `json:"path,omitempty"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
}

type GraphEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type VaultGraph struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
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
