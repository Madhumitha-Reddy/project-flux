package domain

type GitChange struct {
	Path           string `json:"path"`
	OriginalPath   string `json:"originalPath,omitempty"`
	IndexStatus    string `json:"indexStatus"`
	WorktreeStatus string `json:"worktreeStatus"`
}

type GitStatus struct {
	Available   bool        `json:"available"`
	Initialized bool        `json:"initialized"`
	Branch      string      `json:"branch,omitempty"`
	Upstream    string      `json:"upstream,omitempty"`
	Ahead       int         `json:"ahead"`
	Behind      int         `json:"behind"`
	Changes     []GitChange `json:"changes"`
}

type GitDiff struct {
	Path    string `json:"path"`
	Staged  bool   `json:"staged"`
	Content string `json:"content"`
}
