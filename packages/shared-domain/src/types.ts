export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  tags: string[];
  isDeleted: boolean;
}

export interface Block {
  id: string;
  noteId: string;
  type: "text" | "heading" | "code" | "quote" | "list" | "callout";
  content: string;
  order: number;
  metadata?: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  type: "note" | "tag" | "concept";
  label: string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: "reference" | "tag" | "parent" | "related";
  weight?: number;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: Date;
  settings: WorkspaceSettings;
}

export interface WorkspaceSettings {
  theme: "light" | "dark" | "system";
  fontSize: number;
  fontFamily: string;
  autoSave: boolean;
  autoSaveInterval: number;
}
