import { create } from "zustand";

import type { MarkdownMode } from "./markdown-editor";
import type { WorkspaceNode } from "./workspace-tree";
import type { LeftPane, RightPane } from "./workspace-sidebars";
import type { FluxLayoutState } from "@flux/shared-ui/hooks/use-flux-layout";

export type VaultLifecycleState =
  "initializing" | "read_only_ready" | "writable" | "indexing" | "active" | "degraded";

export interface IndexingProgress {
  phase: string;
  processed: number;
  total: number;
  failed: number;
}

export interface PersistedWorkspaceTab {
  id: number;
  path: string;
  mode: MarkdownMode;
  pinned: boolean;
}

export interface PersistedWorkspaceSession {
  version: 1;
  vaultId: string;
  tabs: PersistedWorkspaceTab[];
  activePath?: string;
  workspaceRoot: WorkspaceNode;
  activeLeafId: number;
  leftSidebarPane: LeftPane;
  rightSidebarPane: RightPane;
  layout?: FluxLayoutState;
  expandedFolders?: string[];
}

export interface AppBootstrapState {
  lastVaultPath: string | null;
}

export interface RememberedVault {
  id: string;
  name: string;
  path: string;
}

export interface FluxStatePersistence {
  loadBootstrap(windowId: string): Promise<AppBootstrapState>;
  loadWorkspaceSession(
    windowId: string,
    vaultId?: string
  ): Promise<PersistedWorkspaceSession | null>;
  saveWorkspaceSession(windowId: string, session: PersistedWorkspaceSession): Promise<void>;
  loadAppSettings(): Promise<Record<string, unknown>>;
  saveAppSetting(key: string, value: unknown): Promise<void>;
  rememberVault(vault: RememberedVault): Promise<void>;
  forgetLastVault(): Promise<void>;
}

interface AppState {
  hydrated: boolean;
  vaultId: string | null;
  vaultName: string | null;
  lifecycle: VaultLifecycleState;
  indexing: IndexingProgress | null;
  workspace: PersistedWorkspaceSession | null;
  settings: Record<string, unknown>;
  hydrate(settings: Record<string, unknown>): void;
  setVault(
    vault: { id: string; name: string } | null,
    lifecycle?: VaultLifecycleState,
    indexing?: IndexingProgress | null
  ): void;
  setLifecycle(lifecycle: VaultLifecycleState, indexing?: IndexingProgress | null): void;
  setWorkspace(workspace: PersistedWorkspaceSession | null): void;
  setSetting(key: string, value: unknown): void;
}

export const useAppStore = create<AppState>((set) => ({
  hydrated: false,
  vaultId: null,
  vaultName: null,
  lifecycle: "initializing",
  indexing: null,
  workspace: null,
  settings: {},
  hydrate: (settings) => set({ settings, hydrated: true }),
  setVault: (vault, lifecycle = vault ? "active" : "initializing", indexing = null) =>
    set((current) => ({
      vaultId: vault?.id ?? null,
      vaultName: vault?.name ?? null,
      lifecycle,
      indexing,
      workspace: vault ? current.workspace : null,
    })),
  setLifecycle: (lifecycle, indexing) =>
    set((current) => ({
      lifecycle,
      indexing: indexing === undefined ? current.indexing : indexing,
    })),
  setWorkspace: (workspace) => set({ workspace }),
  setSetting: (key, value) =>
    set((current) => ({ settings: { ...current.settings, [key]: value } })),
}));

const LAST_VAULT_PATH_KEY = "flux-last-vault-path";

function workspaceStorageKey(windowId: string) {
  return `flux-workspace-session:${windowId}`;
}

function parseWorkspace(
  value: string | null,
  legacyVaultId?: string
): PersistedWorkspaceSession | null {
  try {
    const session = JSON.parse(value ?? "null") as
      | PersistedWorkspaceSession
      | { tabs?: Array<Omit<PersistedWorkspaceTab, "id">>; activePath?: string }
      | null;
    if (session && "version" in session && session.version === 1 && Array.isArray(session.tabs)) {
      return session;
    }
    if (!legacyVaultId || !session?.tabs || !Array.isArray(session.tabs)) return null;
    const tabs = session.tabs.map((tab, index) => ({ ...tab, id: index + 1 }));
    const activeId = tabs.find((tab) => tab.path === session.activePath)?.id ?? tabs[0]?.id ?? 1;
    return {
      version: 1,
      vaultId: legacyVaultId,
      tabs,
      activePath: session.activePath,
      workspaceRoot: {
        kind: "leaf",
        id: 1,
        view: "editor",
        tabIds: tabs.map((tab) => tab.id),
        activeTabId: activeId,
      },
      activeLeafId: 1,
      leftSidebarPane: "files",
      rightSidebarPane: "backlinks",
    };
  } catch {
    return null;
  }
}

/** Temporary browser fallback. Desktop/web runtimes replace this with global app SQLite. */
export const browserStatePersistence: FluxStatePersistence = {
  async loadBootstrap() {
    return { lastVaultPath: localStorage.getItem(LAST_VAULT_PATH_KEY) };
  },
  async loadWorkspaceSession(windowId, vaultId) {
    return (
      parseWorkspace(localStorage.getItem(workspaceStorageKey(windowId))) ??
      (vaultId
        ? parseWorkspace(localStorage.getItem(`flux-vault-session:${vaultId}`), vaultId)
        : null)
    );
  },
  async saveWorkspaceSession(windowId, session) {
    localStorage.setItem(workspaceStorageKey(windowId), JSON.stringify(session));
  },
  async loadAppSettings() {
    return {};
  },
  async saveAppSetting() {},
  async rememberVault(vault) {
    localStorage.setItem(LAST_VAULT_PATH_KEY, vault.path);
  },
  async forgetLastVault() {
    localStorage.removeItem(LAST_VAULT_PATH_KEY);
  },
};
