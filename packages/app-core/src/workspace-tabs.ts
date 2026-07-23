import type { DemoDocument, MarkdownMode } from "./markdown-editor";

export interface WorkspaceTab {
  id: number;
  title: string;
  pinned?: boolean;
  kind?: "graph";
  graphRootPath?: string;
  document: DemoDocument | null;
  deferred?: { path: string };
  pdf?: { path: string; data: ArrayBuffer };
  preview?: { path: string; data: ArrayBuffer; mimeType: string };
  mode: MarkdownMode;
  showBacklinks: boolean;
  bookmarked: boolean;
  findRequest: number;
}

export const createWorkspaceTab = (
  id: number,
  document: DemoDocument | null = null
): WorkspaceTab => ({
  id,
  title: document?.title ?? "New tab",
  document,
  mode: "live",
  showBacklinks: false,
  bookmarked: false,
  findRequest: 0,
});

export const createGraphWorkspaceTab = (id: number, graphRootPath?: string): WorkspaceTab => ({
  ...createWorkspaceTab(id),
  title: graphRootPath ? "Local graph" : "Graph view",
  kind: "graph",
  graphRootPath,
});
