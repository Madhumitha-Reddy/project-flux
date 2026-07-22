export type VaultState =
  "closed" | "initializing" | "read_only_ready" | "writable" | "indexing" | "active" | "degraded";

export interface IndexingProgress {
  phase: string;
  processed: number;
  total: number;
  failed: number;
}

export interface VaultFileEvent {
  path: string;
  op: "create" | "write" | "remove" | "reconcile";
}

export interface VaultChange {
  revision: number;
  events?: VaultFileEvent[];
  reconcile?: boolean;
  vault: VaultInfo;
}

export interface ServerStatus {
  status: "healthy" | "degraded";
  version: string;
  vaultConfigured: boolean;
  openVault: VaultInfo | null;
}

export interface OpenVaultRequest {
  path?: string;
}

export interface VaultInfo {
  id: string;
  name: string;
  state: VaultState;
  indexing?: IndexingProgress;
}

export interface RecentVault {
  vaultId: string;
  path: string;
  displayName: string;
  lastOpenedAt: string;
}

export interface VaultLocation {
  vaultId?: string;
  name: string;
  path: string;
}

export interface WorkspaceSession {
  windowId: string;
  vaultId: string;
  state: unknown;
  updatedAt: string;
}

export interface AppBootstrap {
  recentVaults: RecentVault[];
  workspace: WorkspaceSession | null;
  settings: Record<string, unknown>;
}

export interface FileEntry {
  path: string;
  name: string;
  kind: "directory" | "markdown" | "text" | "binary";
  sizeBytes: number;
  modifiedAt: string;
}

export interface CreateFileRequest {
  vaultId: string;
  path: string;
  content?: string;
}

export interface FileDocument {
  path: string;
  content: string;
  contentHash: string;
  modifiedAt: string;
}

export interface GraphNode {
  id: string;
  path?: string;
  label: string;
  kind: FileEntry["kind"] | "missing";
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface VaultGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SaveFileRequest {
  vaultId: string;
  path: string;
  content: string;
  expectedHash?: string;
}

export interface SaveResult {
  path: string;
  contentHash: string;
  modifiedAt: string;
}

export interface TextEdit {
  startByte: number;
  endByte: number;
  text: string;
}

export interface PatchFileRequest {
  vaultId: string;
  path: string;
  expectedHash: string;
  edits: TextEdit[];
}

export interface MoveFileRequest {
  vaultId: string;
  sourcePath: string;
  destinationPath: string;
}

export interface TrashEntry {
  id: string;
  originalPath: string;
  deletedAt: string;
  sizeBytes: number;
}

export type TrashRetentionDays = 7 | 30 | 90;

export interface PurgeResult {
  deleted: number;
}

/** Transport-neutral boundary consumed by application features. */
export interface FluxClient {
  getStatus(): Promise<ServerStatus>;
  getBootstrap(windowId: string): Promise<AppBootstrap>;
  listRecentVaults(): Promise<RecentVault[]>;
  listAvailableVaults(): Promise<VaultLocation[]>;
  rememberVault(vault: Pick<RecentVault, "vaultId" | "path" | "displayName">): Promise<void>;
  forgetVault(vaultId: string): Promise<void>;
  getWorkspace(windowId: string, vaultId?: string): Promise<WorkspaceSession | null>;
  saveWorkspace(windowId: string, vaultId: string, state: unknown): Promise<void>;
  getAppSettings(): Promise<Record<string, unknown>>;
  putAppSetting(key: string, value: unknown): Promise<void>;
  openVault(request?: OpenVaultRequest): Promise<VaultInfo>;
  createVault(request: Required<OpenVaultRequest>): Promise<VaultInfo>;
  getVaultRevision(vaultId: string): Promise<number>;
  watchVaultRevision(
    vaultId: string,
    onRevision: (revision: number) => void,
    onError?: (error: Error) => void
  ): () => void;
  watchVaultChanges(
    vaultId: string,
    onChange: (change: VaultChange) => void,
    onError?: (error: Error) => void
  ): () => void;
  listFiles(vaultId: string): Promise<FileEntry[]>;
  getGraph(vaultId: string): Promise<VaultGraph>;
  getFileMetadata(vaultId: string, path: string): Promise<FileEntry | null>;
  rebuildIndex(vaultId: string): Promise<void>;
  createDirectory(vaultId: string, path: string): Promise<FileEntry>;
  createFile(request: CreateFileRequest): Promise<FileDocument>;
  readFile(vaultId: string, path: string): Promise<FileDocument>;
  readBinaryFile(vaultId: string, path: string): Promise<ArrayBuffer>;
  saveFile(request: SaveFileRequest): Promise<SaveResult>;
  patchFile(request: PatchFileRequest): Promise<SaveResult>;
  moveFile(request: MoveFileRequest): Promise<FileEntry>;
  deleteFile(vaultId: string, path: string): Promise<TrashEntry>;
  restoreFile(vaultId: string, trashId: string): Promise<FileEntry>;
  listTrash(vaultId: string): Promise<TrashEntry[]>;
  permanentlyDelete(vaultId: string, trashId: string): Promise<void>;
  purgeTrash(vaultId: string, retentionDays: TrashRetentionDays): Promise<PurgeResult>;
}

export interface RuntimeCapabilities {
  supportsNativeMenus: boolean;
  supportsFileAccess: boolean;
  supportsRemoteVaults: boolean;
  isDesktop: boolean;
  isWeb: boolean;
}
