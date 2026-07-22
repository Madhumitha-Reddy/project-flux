import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { AnimatePresence, LazyMotion, LayoutGroup, MotionConfig, domAnimation } from "motion/react";
import * as m from "motion/react-m";
import { FluxLayout } from "@flux/shared-ui/components/flux-layout";
import {
  FluxTab,
  FluxTabAddButton,
  FluxTabBar,
  FluxTabMenu,
  FluxStackedTab,
} from "@flux/shared-ui/components/flux-tabs";
import { ModeToggle } from "@flux/shared-ui/components/mode-toggle";
import { FluxStatusBar } from "@flux/shared-ui/components/status-bar";
import { TooltipProvider } from "@flux/shared-ui/components/tooltip";
import { Toaster, toast } from "@flux/shared-ui/components/sonner";
import type {
  FileEntry,
  FluxClient,
  ServerStatus,
  TrashEntry,
  VaultInfo,
} from "@flux/bridge-contract";
import {
  FluxEditorPane,
  FluxTabContextMenu,
  type FluxTabCommands,
} from "@flux/shared-ui/components/workspace-tab";
import {
  DEMO_DOCUMENT,
  MarkdownDocumentMenu,
  MarkdownEditor,
  MarkdownViewToggle,
  REFERENCE_DOCUMENTS,
  type DemoDocument,
} from "./markdown-editor";
import { setFrontmatterProperty } from "./frontmatter";
import { buildLinkIndex } from "./link-index";
import {
  WorkspaceLeftSidebar,
  WorkspaceRibbon,
  WorkspaceRightSidebar,
  WorkspaceSidebarHeader,
  type LeftPane,
  type RightPane,
} from "./workspace-sidebars";
import { GraphView } from "./graph-view";
import { PdfExportDialog } from "./pdf-export";
import { SettingsDialog } from "./settings-dialog";
import { useFluxSettings } from "./settings-store";
import {
  findWorkspaceLeaf,
  mapWorkspaceLeaves,
  mapWorkspaceLeaf,
  moveWorkspaceTab,
  removeWorkspaceLeaf,
  workspaceEdgeLeafIds,
  workspaceHasTab,
  workspaceLeaves,
  WorkspaceTree,
  type WorkspaceLeafView,
  type WorkspaceNode,
} from "./workspace-tree";
import { createWorkspaceTab, type WorkspaceTab } from "./workspace-tabs";

export interface FluxRuntime {
  label: string;
  connect: () => Promise<string>;
  client: FluxClient | null;
  selectVaultDirectory?: (mode: "open" | "create") => Promise<string | null>;
  getPerformanceStats?: () => Promise<FluxPerformanceStats | null>;
  openWindow?: (url: string) => Promise<void>;
  exportPdf?: (options: PdfExportOptions) => Promise<string | null>;
}

export interface PdfExportOptions {
  title: string;
  pageSize: "A4" | "Letter";
  landscape: boolean;
  marginMillimetres: number;
  scale: number;
}

export interface FluxPerformanceStats {
  cpuPercent: number;
  memoryMB: number;
}

export interface FluxAppProps {
  runtime: FluxRuntime;
  windowControlsInset?: number;
}

const DOCUMENT_LIBRARY = [DEMO_DOCUMENT, ...REFERENCE_DOCUMENTS];
const bootstrapStatus = new WeakMap<FluxClient, Promise<ServerStatus>>();
const LAST_VAULT_PATH_KEY = "flux-last-vault-path";

interface PersistedVaultSession {
  tabs: Array<{ path: string; mode: WorkspaceTab["mode"]; pinned: boolean }>;
  activePath?: string;
}

function sessionStorageKey(vaultId: string) {
  return `flux-vault-session:${vaultId}`;
}

function readVaultSession(vaultId: string): PersistedVaultSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(sessionStorageKey(vaultId)) ?? "null") as
      | PersistedVaultSession
      | null;
    if (!value || !Array.isArray(value.tabs)) return null;
    return value;
  } catch {
    return null;
  }
}

function getBootstrapStatus(client: FluxClient) {
  let pending = bootstrapStatus.get(client);
  if (!pending) {
    pending = client.getStatus().catch((error: unknown) => {
      bootstrapStatus.delete(client);
      throw error;
    });
    bootstrapStatus.set(client, pending);
  }
  return pending;
}
const PdfViewer = lazy(() =>
  import("./pdf-viewer").then((module) => ({ default: module.PdfViewer }))
);

function documentFromLocation() {
  if (typeof window === "undefined") return DEMO_DOCUMENT;
  const title = new URLSearchParams(window.location.search).get("popout");
  return DOCUMENT_LIBRARY.find((document) => document.title === title) ?? DEMO_DOCUMENT;
}

function titleFromPath(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.(md|markdown)$/i, "");
}

function fileTitleFromPath(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.[^./]+$/, "");
}

function markdownPath(parent: string, title: string) {
  const safeTitle = title.trim().replace(/[\\/:*?"<>|]/g, "-") || "Untitled";
  return parent ? `${parent}/${safeTitle}.md` : `${safeTitle}.md`;
}

function movedDocumentPath(candidate: string, source: string, destination: string) {
  if (candidate === source) return destination;
  return candidate.startsWith(`${source}/`)
    ? destination + candidate.slice(source.length)
    : candidate;
}

function singleTextEdit(before: string, after: string) {
  const oldRunes = Array.from(before);
  const newRunes = Array.from(after);
  let prefix = 0;
  while (
    prefix < oldRunes.length &&
    prefix < newRunes.length &&
    oldRunes[prefix] === newRunes[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < oldRunes.length - prefix &&
    suffix < newRunes.length - prefix &&
    oldRunes[oldRunes.length - 1 - suffix] === newRunes[newRunes.length - 1 - suffix]
  )
    suffix++;
  const encoder = new TextEncoder();
  return {
    startByte: encoder.encode(oldRunes.slice(0, prefix).join("")).length,
    endByte: encoder.encode(oldRunes.slice(0, oldRunes.length - suffix).join("")).length,
    text: newRunes.slice(prefix, newRunes.length - suffix).join(""),
  };
}

interface AsyncFeedback {
  loading: string;
  success: string;
  error: string;
  id?: string;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function runWithToast<T>(operation: Promise<T>, feedback: AsyncFeedback) {
  return toast
    .promise(operation, {
      id: feedback.id,
      loading: feedback.loading,
      success: feedback.success,
      error: (error) => ({ message: feedback.error, description: errorMessage(error) }),
    })
    .unwrap();
}

export function FluxApp({ runtime, windowControlsInset }: FluxAppProps) {
  const { settings } = useFluxSettings();
  const { plugins, general } = settings;
  const [status, setStatus] = useState("Connecting…");
  const [performanceStats, setPerformanceStats] = useState<FluxPerformanceStats | null>(null);
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [
    createWorkspaceTab(1, documentFromLocation()),
  ]);
  const [activeTabId, setActiveTabId] = useState(1);
  const [activeVaultId, setActiveVaultId] = useState("");
  const [sessionVaultId, setSessionVaultId] = useState("");
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [vaultDocuments, setVaultDocuments] = useState<DemoDocument[]>([]);
  const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
  const [renameRequest, setRenameRequest] = useState<{ path: string; value: string }>();
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([]);
  const [permanentDeleteRequest, setPermanentDeleteRequest] = useState<TrashEntry>();
  const [pdfExportDocument, setPdfExportDocument] = useState<DemoDocument | null>(null);
  const [pdfExportOpen, setPdfExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leftSidebarPane, setLeftSidebarPane] = useState<LeftPane>("files");
  const [rightSidebarPane, setRightSidebarPane] = useState<RightPane>("backlinks");
  const [nextTabId, setNextTabId] = useState(2);
  const [workspaceRoot, setWorkspaceRoot] = useState<WorkspaceNode>({
    kind: "leaf",
    id: 1,
    view: "editor",
    tabIds: [1],
    activeTabId: 1,
  });
  const [activeLeafId, setActiveLeafId] = useState(1);
  const nextLeafIdRef = useRef(2);
  const savedDocumentsRef = useRef(new Map<string, DemoDocument>());
  const vaultFileVersionsRef = useRef(new Map<string, string>());
  const saveTimersRef = useRef(new Map<string, number>());
  const saveChainsRef = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    if (plugins["file-explorer"] === false && leftSidebarPane === "files") {
      if (plugins["search"] !== false) setLeftSidebarPane("search");
      else if (plugins["bookmarks"] !== false) setLeftSidebarPane("bookmarks");
    } else if (plugins["search"] === false && leftSidebarPane === "search") {
      if (plugins["file-explorer"] !== false) setLeftSidebarPane("files");
      else if (plugins["bookmarks"] !== false) setLeftSidebarPane("bookmarks");
    } else if (plugins["bookmarks"] === false && leftSidebarPane === "bookmarks") {
      if (plugins["file-explorer"] !== false) setLeftSidebarPane("files");
      else if (plugins["search"] !== false) setLeftSidebarPane("search");
    }

    if (plugins["graph-view"] === false) {
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaves(root, (leaf) =>
          leaf.view === "graph" ? { ...leaf, view: "editor" } : leaf
        )
      );
    }
  }, [plugins, leftSidebarPane, rightSidebarPane]);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeLeaf = findWorkspaceLeaf(workspaceRoot, activeLeafId);
  const visibleActiveTab =
    activeLeaf?.view === "editor"
      ? tabs.find((tab) => tab.id === activeLeaf.activeTabId)
      : undefined;
  const documents = useMemo(() => {
    const library = vault ? vaultDocuments : DOCUMENT_LIBRARY;
    const byTitle = new Map(library.map((document) => [document.title, document]));
    for (const tab of tabs) if (tab.document) byTitle.set(tab.document.title, tab.document);
    return [...byTitle.values()];
  }, [tabs, vault, vaultDocuments]);
  const leftEdgeLeafIds = useMemo(
    () => new Set(workspaceEdgeLeafIds(workspaceRoot, "left")),
    [workspaceRoot]
  );
  const rightEdgeLeafIds = useMemo(
    () => new Set(workspaceEdgeLeafIds(workspaceRoot, "right")),
    [workspaceRoot]
  );

  useEffect(() => {
    if (!runtime.getPerformanceStats) return;

    let active = true;
    const refreshPerformanceStats = async () => {
      try {
        const nextStats = await runtime.getPerformanceStats?.();
        if (active && nextStats) setPerformanceStats(nextStats);
      } catch {
        if (active) setPerformanceStats(null);
      }
    };

    void refreshPerformanceStats();
    const interval = window.setInterval(() => void refreshPerformanceStats(), 10_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [runtime]);

  const addTab = () => {
    const id = nextTabId;
    setNextTabId((current) => current + 1);
    setTabs((current) => [...current, createWorkspaceTab(id)]);
    setActiveTabId(id);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, activeLeafId, (leaf) => ({
        ...leaf,
        view: "editor",
        tabIds: [...leaf.tabIds, id],
        activeTabId: id,
      }))
    );
  };

  const closeOtherTabs = (id: number) => {
    setTabs((current) => current.filter((tab) => tab.id === id));
    setActiveTabId(id);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaves(root, (leaf) => ({
        ...leaf,
        view: "editor",
        tabIds: [id],
        activeTabId: id,
      }))
    );
  };

  const closeTabsAfter = (id: number) => {
    const tabIndex = tabs.findIndex((tab) => tab.id === id);
    if (tabIndex < 0) return;

    const nextTabs = tabs.slice(0, tabIndex + 1);
    setTabs(nextTabs);
    if (!nextTabs.some((tab) => tab.id === activeTabId)) setActiveTabId(id);
  };

  const closeAllTabs = () => {
    const replacement = createWorkspaceTab(nextTabId);
    setNextTabId((current) => current + 1);
    setTabs([replacement]);
    setActiveTabId(replacement.id);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaves(root, (leaf) => ({
        ...leaf,
        view: "editor",
        tabIds: [replacement.id],
        activeTabId: replacement.id,
      }))
    );
  };

  const togglePinned = (id: number) => {
    setTabs((current) =>
      current.map((tab) => (tab.id === id ? { ...tab, pinned: !tab.pinned } : tab))
    );
  };

  const updateTab = (id: number, update: (tab: WorkspaceTab) => WorkspaceTab) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? update(tab) : tab)));
  };

  const setLeafView = (id: number, view: WorkspaceLeafView) => {
    setWorkspaceRoot((root) => mapWorkspaceLeaf(root, id, (leaf) => ({ ...leaf, view })));
    setActiveLeafId(id);
  };

  const splitLeaf = (id: number, direction: "horizontal" | "vertical") => {
    const secondLeafId = nextLeafIdRef.current++;
    const splitId = nextLeafIdRef.current++;
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, id, (leaf) => ({
        kind: "split",
        id: splitId,
        direction,
        children: [leaf, { ...leaf, id: secondLeafId, tabIds: [leaf.activeTabId] }],
      }))
    );
    setActiveLeafId(secondLeafId);
  };

  const closeLeafTab = (leafId: number, tabId: number) => {
    const leaf = findWorkspaceLeaf(workspaceRoot, leafId);
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!leaf || !tab) return;

    const leaves = workspaceLeaves(workspaceRoot);
    if (leaves.length === 1 && leaf.tabIds.length === 1) {
      if (!tab.document) return;
      const replacement = createWorkspaceTab(nextTabId);
      setNextTabId((current) => current + 1);
      setTabs((current) => [...current.filter((candidate) => candidate.id !== tabId), replacement]);
      setWorkspaceRoot({
        ...leaf,
        view: "editor",
        tabIds: [replacement.id],
        activeTabId: replacement.id,
      });
      setActiveTabId(replacement.id);
      return;
    }

    if (leaf.tabIds.length === 1) {
      const nextRoot = removeWorkspaceLeaf(workspaceRoot, leafId);
      if (!nextRoot) return;
      const nextLeaf = workspaceLeaves(nextRoot)[0];
      setWorkspaceRoot(nextRoot);
      setActiveLeafId(nextLeaf.id);
      setActiveTabId(nextLeaf.activeTabId);
      if (!workspaceHasTab(nextRoot, tabId)) {
        setTabs((current) => current.filter((candidate) => candidate.id !== tabId));
      }
      return;
    }

    const tabIds = leaf.tabIds.filter((id) => id !== tabId);
    const nextActiveId = leaf.activeTabId === tabId ? tabIds[0] : leaf.activeTabId;
    const nextRoot = mapWorkspaceLeaf(workspaceRoot, leafId, (current) => ({
      ...current,
      view: "editor",
      tabIds,
      activeTabId: nextActiveId,
    }));
    setWorkspaceRoot(nextRoot);
    setActiveTabId(nextActiveId);
    if (!workspaceHasTab(nextRoot, tabId)) {
      setTabs((current) => current.filter((candidate) => candidate.id !== tabId));
    }
  };

  const replaceWorkspaceDocument = (document: DemoDocument | null) => {
    const replacement = createWorkspaceTab(1, document);
    setTabs([replacement]);
    setActiveTabId(1);
    setNextTabId(2);
    setWorkspaceRoot({ kind: "leaf", id: 1, view: "editor", tabIds: [1], activeTabId: 1 });
    setActiveLeafId(1);
  };

  const refreshFiles = async (vaultId = vault?.id) => {
    if (!runtime.client || !vaultId) return [];
    const entries = await runtime.client.listFiles(vaultId);
    setFileEntries(entries);
    return entries;
  };

  const refreshVaultDocuments = async (vaultId: string, entries: FileEntry[]) => {
    if (!runtime.client) return [];
    const markdownEntries = entries.filter(
      (entry) =>
        (entry.kind === "markdown" || entry.kind === "text") &&
        savedDocumentsRef.current.has(entry.path)
    );
    const loaded = await Promise.all(
      markdownEntries.map(async (entry) => {
        const version = `${entry.modifiedAt}:${entry.sizeBytes}`;
        const cached = savedDocumentsRef.current.get(entry.path);
        if (cached && vaultFileVersionsRef.current.get(entry.path) === version) return cached;
        const file = await runtime.client!.readFile(vaultId, entry.path);
        return {
          title: titleFromPath(file.path),
          path: file.path,
          content: file.content,
          contentHash: file.contentHash,
        } satisfies DemoDocument;
      })
    );
    const visiblePaths = new Set(entries.map((entry) => entry.path));
    for (const path of savedDocumentsRef.current.keys()) {
      if (!visiblePaths.has(path)) savedDocumentsRef.current.delete(path);
    }
    for (const path of vaultFileVersionsRef.current.keys()) {
      if (!visiblePaths.has(path)) vaultFileVersionsRef.current.delete(path);
    }
    for (let index = 0; index < loaded.length; index += 1) {
      const document = loaded[index];
      const entry = markdownEntries[index];
      if (document?.path && entry) {
        savedDocumentsRef.current.set(document.path, document);
        vaultFileVersionsRef.current.set(entry.path, `${entry.modifiedAt}:${entry.sizeBytes}`);
      }
    }
    setVaultDocuments(loaded);
    return loaded;
  };

  const loadVault = async (info: VaultInfo) => {
    if (!runtime.client) return;
    setStatus(`Opening ${info.name}…`);
    setSessionVaultId("");
    setVault(info);
    setActiveVaultId(info.id);
    setVaultDocuments([]);
    savedDocumentsRef.current.clear();
    vaultFileVersionsRef.current.clear();
    const entries = await refreshFiles(info.id);
    const persisted = readVaultSession(info.id);
    const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
    const requestedTabs =
      persisted?.tabs.filter(({ path }) => {
        const entry = entryByPath.get(path);
        return entry?.kind === "markdown" || entry?.kind === "text";
      }) ?? [];
    const loaded = await Promise.all(
      requestedTabs.map(async ({ path, mode, pinned }, index) => {
        const file = await runtime.client!.readFile(info.id, path);
        const document: DemoDocument = {
          title: titleFromPath(file.path),
          path: file.path,
          content: file.content,
          contentHash: file.contentHash,
        };
        const entry = entryByPath.get(path);
        savedDocumentsRef.current.set(path, document);
        if (entry) vaultFileVersionsRef.current.set(path, `${entry.modifiedAt}:${entry.sizeBytes}`);
        return { ...createWorkspaceTab(index + 1, document), mode, pinned };
      })
    );
    setVaultDocuments(loaded.flatMap((tab) => (tab.document ? [tab.document] : [])));
    if (!loaded.length) {
      replaceWorkspaceDocument(null);
    } else {
      const active =
        loaded.find((tab) => tab.document?.path === persisted?.activePath) ?? loaded[0];
      const tabIds = loaded.map((tab) => tab.id);
      setTabs(loaded);
      setActiveTabId(active.id);
      setNextTabId(loaded.length + 1);
      setWorkspaceRoot({
        kind: "leaf",
        id: 1,
        view: "editor",
        tabIds,
        activeTabId: active.id,
      });
      setActiveLeafId(1);
    }
    setSessionVaultId(info.id);
    setVaultPickerOpen(false);
    setStatus(`Go backend connected · ${info.name}`);
  };

  useEffect(() => {
    if (!vault || sessionVaultId !== vault.id) return;
    const persisted: PersistedVaultSession = {
      tabs: tabs.flatMap((tab) =>
        tab.document?.path
          ? [{ path: tab.document.path, mode: tab.mode, pinned: Boolean(tab.pinned) }]
          : []
      ),
      activePath: tabs.find((tab) => tab.id === activeTabId)?.document?.path,
    };
    localStorage.setItem(sessionStorageKey(vault.id), JSON.stringify(persisted));
  }, [activeTabId, sessionVaultId, tabs, vault]);

  useEffect(() => {
    if (!runtime.client || !vault) return;
    let active = true;
    let knownRevision: number | undefined;
    let refreshing = false;
    let pendingRefresh = false;
    const reconcile = async () => {
      if (refreshing) {
        pendingRefresh = true;
        return;
      }
      refreshing = true;
      try {
        do {
          pendingRefresh = false;
          const entries = await refreshFiles(vault.id);
          if (active) await refreshVaultDocuments(vault.id, entries);
        } while (active && pendingRefresh);
      } finally {
        refreshing = false;
      }
    };
    const stop = runtime.client.watchVaultRevision(
      vault.id,
      (revision) => {
        if (!active) return;
        if (knownRevision === undefined) {
          knownRevision = revision;
          return;
        }
        if (revision !== knownRevision) {
          knownRevision = revision;
          void reconcile();
        }
      },
      () => {
        // Browser EventSource and the desktop bridge reconnect automatically.
      }
    );
    return () => {
      active = false;
      stop();
    };
    // runtime client is shell-owned; vault id selects watcher stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime.client, vault?.id]);

  const chooseVault = async (mode: "open" | "create") => {
    if (!runtime.client || !runtime.selectVaultDirectory) return;
    const path = await runtime.selectVaultDirectory(mode);
    if (!path) return;
    try {
      await runWithToast(
        (async () => {
          const info =
            mode === "create"
              ? await runtime.client!.createVault({ path })
              : await runtime.client!.openVault({ path });
          await loadVault(info);
          localStorage.setItem(LAST_VAULT_PATH_KEY, path);
        })(),
        {
          loading: mode === "create" ? "Creating vault…" : "Opening vault…",
          success: mode === "create" ? "Vault created" : "Vault opened",
          error: mode === "create" ? "Could not create vault" : "Could not open vault",
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Vault operation failed");
    }
  };

  const persistDocument = async (tabId: number, document: DemoDocument, content: string) => {
    if (!runtime.client || !vault || !document.path) return;
    const path = document.path;
    const saved = savedDocumentsRef.current.get(path) ?? document;
    if (!saved.contentHash || saved.content === content) return;
    const result = await runtime.client.patchFile({
      vaultId: vault.id,
      path,
      expectedHash: saved.contentHash,
      edits: [singleTextEdit(saved.content, content)],
    });
    const next = { ...saved, content, contentHash: result.contentHash };
    savedDocumentsRef.current.set(path, next);
    setVaultDocuments((current) =>
      current.map((item) =>
        item.path === path ? { ...item, content, contentHash: result.contentHash } : item
      )
    );
    updateTab(tabId, (tab) =>
      tab.document?.path === path && tab.document.content === content
        ? { ...tab, document: { ...tab.document, contentHash: result.contentHash } }
        : tab
    );
  };

  const enqueueSave = (tabId: number, document: DemoDocument, content: string) => {
    if (!document.path) return Promise.resolve();
    const previous = saveChainsRef.current.get(document.path) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => persistDocument(tabId, document, content));
    saveChainsRef.current.set(document.path, next);
    return next;
  };

  const scheduleSave = (tabId: number, document: DemoDocument, content: string) => {
    if (!document.path || !document.contentHash) return;
    const existing = saveTimersRef.current.get(document.path);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      void enqueueSave(tabId, document, content).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown save error";
        setStatus(`Save failed · ${message}`);
        toast.error(`Could not save ${titleFromPath(document.path!)}`, { description: message });
      });
    }, 500);
    saveTimersRef.current.set(document.path, timer);
  };

  const movePath = async (
    sourcePath: string,
    destinationPath: string,
    feedback: AsyncFeedback | null = {
      loading: `Moving ${sourcePath}…`,
      success: `Moved to ${destinationPath}`,
      error: `Could not move ${sourcePath}`,
    }
  ) => {
    if (!runtime.client || !vault || sourcePath === destinationPath) return false;
    try {
      const operation = (async () => {
        for (const tab of tabs) {
          if (!tab.document?.path) continue;
          const timer = saveTimersRef.current.get(tab.document.path);
          if (timer) window.clearTimeout(timer);
          await enqueueSave(tab.id, tab.document, tab.document.content);
        }
        await runtime.client!.moveFile({ vaultId: vault.id, sourcePath, destinationPath });
        setTabs((current) =>
          current.map((tab) => {
            if (tab.pdf) {
              const path = movedDocumentPath(tab.pdf.path, sourcePath, destinationPath);
              return path === tab.pdf.path
                ? tab
                : { ...tab, title: fileTitleFromPath(path), pdf: { ...tab.pdf, path } };
            }
            if (!tab.document?.path) return tab;
            const path = movedDocumentPath(tab.document.path, sourcePath, destinationPath);
            return path === tab.document.path
              ? tab
              : {
                  ...tab,
                  title: titleFromPath(path),
                  document: { ...tab.document, path, title: titleFromPath(path) },
                };
          })
        );
        setVaultDocuments((current) =>
          current.map((document) => {
            if (!document.path) return document;
            const path = movedDocumentPath(document.path, sourcePath, destinationPath);
            return path === document.path
              ? document
              : { ...document, path, title: titleFromPath(path) };
          })
        );
        for (const [path, document] of savedDocumentsRef.current) {
          const nextPath = movedDocumentPath(path, sourcePath, destinationPath);
          if (nextPath !== path) {
            savedDocumentsRef.current.delete(path);
            savedDocumentsRef.current.set(nextPath, {
              ...document,
              path: nextPath,
              title: titleFromPath(nextPath),
            });
          }
        }
        await refreshFiles();
        for (const tab of tabs) {
          if (!tab.document?.path) continue;
          const nextPath = movedDocumentPath(tab.document.path, sourcePath, destinationPath);
          const file = await runtime.client!.readFile(vault.id, nextPath);
          const document: DemoDocument = {
            title: titleFromPath(file.path),
            path: file.path,
            content: file.content,
            contentHash: file.contentHash,
          };
          savedDocumentsRef.current.set(file.path, document);
          updateTab(tab.id, (current) => ({ ...current, title: document.title, document }));
          setVaultDocuments((current) => [
            ...current.filter(
              (item) => item.path !== tab.document?.path && item.path !== file.path
            ),
            document,
          ]);
        }
        setStatus(`Moved · ${destinationPath}`);
      })();
      if (feedback) await runWithToast(operation, feedback);
      else await operation;
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Move failed");
      return false;
    }
  };

  const renamePath = (sourcePath: string, requestedName?: string) => {
    const name = requestedName?.trim();
    if (!name) return;
    const parent = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
    const sourceEntry = fileEntries.find((entry) => entry.path === sourcePath);
    const extension =
      sourceEntry?.kind === "directory" ? "" : (sourcePath.match(/\.[^./]+$/)?.[0] ?? "");
    const finalName =
      extension && !name.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase())
        ? `${name}${extension}`
        : name;
    const destinationPath = parent ? `${parent}/${finalName}` : finalName;
    void movePath(sourcePath, destinationPath, {
      loading: `Renaming ${sourcePath}…`,
      success: `Renamed to ${finalName}`,
      error: `Could not rename ${sourcePath}`,
    });
  };

  const deletePath = async (path: string) => {
    if (!runtime.client || !vault) return;
    if (general.confirmDeleteNote && !window.confirm(`Are you sure you want to delete "${path}"?`)) return;
    try {
      await runWithToast(
        (async () => {
          await runtime.client!.deleteFile(vault.id, path);
          for (const document of tabs.map((tab) => tab.document)) {
            if (
              !document?.path ||
              (document.path !== path && !document.path.startsWith(`${path}/`))
            )
              continue;
            const timer = saveTimersRef.current.get(document.path);
            if (timer) window.clearTimeout(timer);
            savedDocumentsRef.current.delete(document.path);
          }
          const activePath = activeTab?.document?.path ?? activeTab?.pdf?.path;
          const activeWasDeleted = activePath === path || activePath?.startsWith(`${path}/`);
          setTabs((current) =>
            current.filter((tab) => {
              const candidate = tab.document?.path ?? tab.pdf?.path;
              return !candidate || (candidate !== path && !candidate.startsWith(`${path}/`));
            })
          );
          if (activeWasDeleted) replaceWorkspaceDocument(null);
          setVaultDocuments((current) =>
            current.filter(
              (document) =>
                !document.path || (document.path !== path && !document.path.startsWith(`${path}/`))
            )
          );
          await refreshFiles();
          if (trashOpen) await refreshTrash();
          setStatus(`Moved to trash · ${path}`);
        })(),
        {
          loading: `Moving ${path} to trash…`,
          success: `Moved ${path} to trash`,
          error: `Could not move ${path} to trash`,
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Delete failed");
    }
  };

  const archivePath = async (path: string) => {
    if (!runtime.client || !vault || path === "archive" || path.startsWith("archive/")) return;
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const archiveParent = parent ? `archive/${parent}` : "archive";
    try {
      await runWithToast(
        (async () => {
          await runtime.client!.createDirectory(vault.id, archiveParent);
          if (!(await movePath(path, `archive/${path}`, null))) throw new Error("Move failed");
          setStatus(`Archived · ${path}`);
        })(),
        {
          loading: `Archiving ${path}…`,
          success: `Archived ${path}`,
          error: `Could not archive ${path}`,
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Archive failed");
    }
  };

  const refreshTrash = async () => {
    if (!runtime.client || !vault) return [];
    const entries = await runtime.client.listTrash(vault.id);
    setTrashEntries(entries);
    return entries;
  };

  const openTrash = async () => {
    setTrashOpen(true);
    try {
      await refreshTrash();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load trash");
    }
  };

  const restoreTrashEntry = async (entry: TrashEntry) => {
    if (!runtime.client || !vault) return;
    try {
      await runWithToast(
        (async () => {
          await runtime.client!.restoreFile(vault.id, entry.id);
          await Promise.all([refreshFiles(), refreshTrash()]);
          setStatus(`Restored · ${entry.originalPath}`);
        })(),
        {
          loading: `Restoring ${entry.originalPath}…`,
          success: `Restored ${entry.originalPath}`,
          error: `Could not restore ${entry.originalPath}`,
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Restore failed");
    }
  };

  const permanentlyDeleteTrashEntry = async (entry: TrashEntry) => {
    if (!runtime.client || !vault) return;
    try {
      await runWithToast(
        (async () => {
          await runtime.client!.permanentlyDelete(vault.id, entry.id);
          await refreshTrash();
          setPermanentDeleteRequest(undefined);
          setStatus(`Permanently deleted · ${entry.originalPath}`);
        })(),
        {
          loading: `Permanently deleting ${entry.originalPath}…`,
          success: `Permanently deleted ${entry.originalPath}`,
          error: `Could not permanently delete ${entry.originalPath}`,
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Permanent deletion failed");
    }
  };

  const createFolder = async (parent: string, requestedName: string) => {
    if (!runtime.client || !vault) return;
    const name = requestedName.trim();
    if (!name) return;
    try {
      const path = parent ? `${parent}/${name}` : name;
      await runWithToast(
        (async () => {
          await runtime.client!.createDirectory(vault.id, path);
          await refreshFiles();
          setStatus(`Created folder · ${name}`);
        })(),
        {
          loading: `Creating folder ${name}…`,
          success: `Created folder ${name}`,
          error: `Could not create folder ${name}`,
        }
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Create folder failed");
    }
  };

  const editorFor = (tab: WorkspaceTab) => {
    if (!tab.document) return null;

    return (
      <MarkdownEditor
        document={tab.document}
        mode={plugins["live-preview"] === false ? "source" : tab.mode}
        onChange={(content) => {
          if (tab.document) scheduleSave(tab.id, tab.document, content);
          updateTab(tab.id, (current) =>
            current.document ? { ...current, document: { ...current.document, content } } : current
          );
        }}
        onTitleChange={(title) =>
          updateTab(tab.id, (current) =>
            current.document
              ? {
                  ...current,
                  title: title || "Untitled",
                  document: { ...current.document, title },
                }
              : current
          )
        }
        onTitleCommit={(title) => {
          if (tab.document?.path && title.trim() && title !== titleFromPath(tab.document.path)) {
            renamePath(tab.document.path, title.trim());
          }
        }}
        showBacklinks={tab.showBacklinks}
        findRequest={tab.findRequest}
        onDropDocument={openDocument}
        onOpenDocument={openDocument}
        documents={documents}
      />
    );
  };

  const renameFile = (id: number) => {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab?.document) return;
    if (tab.document.path) {
      setRenameRequest({ path: tab.document.path, value: tab.document.title });
      return;
    }
    const title = window.prompt("Rename file", tab.document.title)?.trim();
    if (!title) return;
    updateTab(id, (current) =>
      current.document ? { ...current, title, document: { ...current.document, title } } : current
    );
  };

  const addProperty = (id: number) => {
    const name = window.prompt("Property name")?.trim();
    if (!name) return;
    const value = window.prompt(`Value for ${name}`)?.trim() ?? "";
    updateTab(id, (current) =>
      current.document
        ? {
            ...current,
            document: {
              ...current.document,
              content: setFrontmatterProperty(current.document.content, name, value),
            },
          }
        : current
    );
  };

  const openFind = (id: number) => {
    updateTab(id, (current) => ({
      ...current,
      mode: "live",
      findRequest: current.findRequest + 1,
    }));
  };

  const isProtectedNewTab = (tab: WorkspaceTab, leafId: number) => {
    const leaf = findWorkspaceLeaf(workspaceRoot, leafId);
    return (
      !tab.document &&
      !tab.pdf &&
      workspaceLeaves(workspaceRoot).length === 1 &&
      leaf?.tabIds.length === 1
    );
  };

  const commandsFor = (tab: WorkspaceTab, leafId = activeLeafId): FluxTabCommands => {
    const tabIndex = tabs.findIndex((candidate) => candidate.id === tab.id);
    const protectedNewTab = isProtectedNewTab(tab, leafId);

    return {
      pinned: tab.pinned,
      canCloseOthers: tabs.length > 1,
      canCloseAfter: tabIndex >= 0 && tabIndex < tabs.length - 1,
      onClose: protectedNewTab ? undefined : () => closeLeafTab(leafId, tab.id),
      onCloseOthers: () => closeOtherTabs(tab.id),
      onCloseAfter: () => closeTabsAfter(tab.id),
      onCloseAll: closeAllTabs,
      onTogglePin: () => togglePinned(tab.id),
      onMoveToNewWindow: () => popOutTab(tab),
      onSplitRight: () => splitLeaf(leafId, "horizontal"),
      onSplitDown: () => splitLeaf(leafId, "vertical"),
    };
  };

  const markDraggedTab = (
    event: DragEvent<HTMLDivElement>,
    title: string,
    tabId: number,
    leafId: number
  ) => {
    event.dataTransfer.setData("text/plain", title);
    event.dataTransfer.setData("application/x-flux-tab", JSON.stringify({ tabId, leafId }));
    event.dataTransfer.effectAllowed = "move";
  };

  const activateLeafTab = (leafId: number, tabId: number) => {
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, leafId, (leaf) => ({
        ...leaf,
        view: tabId === leaf.activeTabId ? leaf.view : "editor",
        activeTabId: tabId,
      }))
    );
    setActiveLeafId(leafId);
    setActiveTabId(tabId);
  };

  const moveTabToLeaf = (event: DragEvent, targetLeafId: number) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData("application/x-flux-tab");
    if (!payload) return;
    let parsed: { tabId: number; leafId: number };
    try {
      parsed = JSON.parse(payload) as { tabId: number; leafId: number };
    } catch {
      return;
    }
    if (!Number.isInteger(parsed.tabId) || !Number.isInteger(parsed.leafId)) return;
    if (parsed.leafId === targetLeafId) return;
    setWorkspaceRoot((root) => moveWorkspaceTab(root, parsed.tabId, parsed.leafId, targetLeafId));
    setActiveLeafId(targetLeafId);
    setActiveTabId(parsed.tabId);
  };

  const wasDroppedAtWindowEdge = (event: DragEvent<HTMLDivElement>) =>
    event.clientX === 0 && event.clientY === 0;

  const openNewNote = (id: number) => {
    updateTab(id, (tab) => ({
      ...tab,
      title: "Untitled",
      document: { title: "Untitled", content: "" },
      mode: "live",
      showBacklinks: false,
      bookmarked: false,
    }));
  };

  const openDemoNote = (id: number) => {
    updateTab(id, (tab) => ({
      ...tab,
      title: DEMO_DOCUMENT.title,
      document: DEMO_DOCUMENT,
      mode: "live",
      showBacklinks: false,
      bookmarked: false,
    }));
  };

  const mergeFile = (id: number, leafId: number) => {
    const source = tabs.find((tab) => tab.id === id)?.document;
    if (!source) return;
    const choices = tabs
      .filter((tab) => tab.id !== id && tab.document)
      .map((tab) => tab.document?.title)
      .filter(Boolean)
      .join(", ");
    const targetTitle = window.prompt(`Merge into file${choices ? ` (${choices})` : ""}`)?.trim();
    if (!targetTitle) return;
    const target = tabs.find((tab) => tab.document?.title === targetTitle);
    if (!target) return;
    updateTab(target.id, (tab) =>
      tab.document
        ? {
            ...tab,
            document: {
              ...tab.document,
              content: `${tab.document.content.trimEnd()}\n\n${source.content.trimStart()}`,
            },
          }
        : tab
    );
    closeLeafTab(leafId, id);
    setActiveTabId(target.id);
  };

  const paneFor = (tab: WorkspaceTab, leafId = activeLeafId) => (
    <FluxEditorPane
      title={tab.title}
      headerAction={
        tab.document ? (
          <MarkdownViewToggle
            mode={tab.mode}
            onModeChange={(mode) => updateTab(tab.id, (current) => ({ ...current, mode }))}
          />
        ) : null
      }
      menuContent={
        tab.document ? (
          <MarkdownDocumentMenu
            title={tab.document.title}
            mode={tab.mode}
            showBacklinks={tab.showBacklinks}
            bookmarked={tab.bookmarked}
            onModeChange={(mode) => updateTab(tab.id, (current) => ({ ...current, mode }))}
            onBacklinksChange={(showBacklinks) =>
              updateTab(tab.id, (current) => ({ ...current, showBacklinks }))
            }
            onBookmarkChange={(bookmarked) =>
              updateTab(tab.id, (current) => ({ ...current, bookmarked }))
            }
            onRename={() => renameFile(tab.id)}
            onAddProperty={() => addProperty(tab.id)}
            onFind={() => openFind(tab.id)}
            onDelete={() => {
              if (tab.document?.path) void deletePath(tab.document.path);
              else closeLeafTab(leafId, tab.id);
            }}
            onMerge={() => mergeFile(tab.id, leafId)}
            onVersionHistory={() =>
              window.alert("Version history will appear after this note has saved revisions.")
            }
            onRevealInNavigation={() => setLeftSidebarPane("files")}
            onOpenLinkedView={(view) => {
              if (view === "graph") setLeafView(leafId, "graph");
              else setRightSidebarPane(view);
            }}
            onMoveToNewWindow={() => popOutTab(tab)}
            onSplitRight={() => splitLeaf(leafId, "horizontal")}
            onSplitDown={() => splitLeaf(leafId, "vertical")}
            onExportPdf={() => {
              setPdfExportDocument(tab.document ?? null);
              setPdfExportOpen(true);
            }}
          />
        ) : undefined
      }
      {...commandsFor(tab, leafId)}
    >
      {tab.pdf ? (
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-xs text-muted-foreground">
              Loading PDF…
            </div>
          }
        >
          <PdfViewer key={tab.pdf.path} title={tab.title} data={tab.pdf.data} />
        </Suspense>
      ) : tab.document ? (
        editorFor(tab)
      ) : (
        <div className="grid h-full place-items-center">
          <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => openNewNote(tab.id)}
            >
              Create new note (⌘ N)
            </button>
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => openDemoNote(tab.id)}
            >
              Go to file (⌘ O)
            </button>
            {!isProtectedNewTab(tab, leafId) ? (
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => closeLeafTab(leafId, tab.id)}
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      )}
    </FluxEditorPane>
  );

  const backlinksCount = visibleActiveTab?.document
    ? (buildLinkIndex(documents).backlinks.get(visibleActiveTab.document.title)?.size ?? 0)
    : 0;

  const openDocument = async (identifier: string) => {
    const exactEntry = vault ? fileEntries.find((entry) => entry.path === identifier) : undefined;
    const titleMatches = vault
      ? fileEntries.filter(
          (entry) => entry.kind === "markdown" && titleFromPath(entry.path) === identifier
        )
      : [];
    const requestedEntry = exactEntry ?? (titleMatches.length === 1 ? titleMatches[0] : undefined);
    const requestedPath = vault
      ? (requestedEntry?.path ??
        vaultDocuments.find((document) => document.title === identifier)?.path ??
        (/\.(md|markdown)$/i.test(identifier) ? identifier : undefined))
      : undefined;
    const existing = tabs.find((tab) =>
      requestedPath
        ? tab.document?.path === requestedPath || tab.pdf?.path === requestedPath
        : tab.document?.title === identifier
    );
    if (existing) {
      setActiveTabId(existing.id);
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaf(root, activeLeafId, (leaf) => ({
          ...leaf,
          view: "editor",
          tabIds: leaf.tabIds.includes(existing.id) ? leaf.tabIds : [...leaf.tabIds, existing.id],
          activeTabId: existing.id,
        }))
      );
      return;
    }

    const placeTab = (create: (id: number) => WorkspaceTab) => {
      const leaf = findWorkspaceLeaf(workspaceRoot, activeLeafId);
      const emptyTab =
        leaf?.tabIds.length === 1
          ? tabs.find(
              (tab) => tab.id === leaf.activeTabId && !tab.document && !tab.pdf && !tab.pinned
            )
          : undefined;
      if (emptyTab) {
        const replacement = create(emptyTab.id);
        setTabs((current) => current.map((tab) => (tab.id === emptyTab.id ? replacement : tab)));
        setActiveTabId(emptyTab.id);
        setWorkspaceRoot((root) =>
          mapWorkspaceLeaf(root, activeLeafId, (current) => ({
            ...current,
            view: "editor",
            activeTabId: emptyTab.id,
          }))
        );
        return;
      }
      const id = nextTabId;
      setNextTabId((current) => current + 1);
      setTabs((current) => [...current, create(id)]);
      setActiveTabId(id);
      setWorkspaceRoot((root) =>
        mapWorkspaceLeaf(root, activeLeafId, (leaf) => ({
          ...leaf,
          view: "editor",
          tabIds: [...leaf.tabIds, id],
          activeTabId: id,
        }))
      );
    };

    if (requestedEntry?.kind === "binary") {
      if (!/\.pdf$/i.test(requestedEntry.path) || !runtime.client || !vault) {
        toast.info(`Preview unavailable for ${requestedEntry.name}`);
        return;
      }
      try {
        const data = await runWithToast(
          runtime.client.readBinaryFile(vault.id, requestedEntry.path),
          {
            loading: `Opening ${requestedEntry.name}…`,
            success: `Opened ${requestedEntry.name}`,
            error: `Could not open ${requestedEntry.name}`,
          }
        );
        placeTab((id) => ({
          ...createWorkspaceTab(id),
          title: fileTitleFromPath(requestedEntry.path),
          pdf: { path: requestedEntry.path, data },
        }));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Open PDF failed");
      }
      return;
    }

    let document = requestedPath
      ? vaultDocuments.find((candidate) => candidate.path === requestedPath)
      : documents.find((candidate) => candidate.title === identifier);
    if (!document && requestedPath && runtime.client && vault) {
      try {
        const file = await runtime.client.readFile(vault.id, requestedPath);
        document = {
          title: titleFromPath(file.path),
          path: file.path,
          content: file.content,
          contentHash: file.contentHash,
        };
        savedDocumentsRef.current.set(file.path, document);
        const entry = fileEntries.find((candidate) => candidate.path === file.path);
        if (entry)
          vaultFileVersionsRef.current.set(file.path, `${entry.modifiedAt}:${entry.sizeBytes}`);
        setVaultDocuments((current) => [
          ...current.filter((item) => item.path !== file.path),
          document!,
        ]);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Open file failed");
        return;
      }
    }
    if (!document) return;
    placeTab((id) => createWorkspaceTab(id, document));
  };

  const createNote = async (parent = "", requestedName = "Untitled") => {
    if (vault && runtime.client) {
      const titles = new Set(fileEntries.map((entry) => entry.path.toLocaleLowerCase()));
      let suffix = 0;
      const base = requestedName.replace(/\.(md|markdown)$/i, "") || "Untitled";
      let path = markdownPath(parent, base);
      while (titles.has(path.toLocaleLowerCase()))
        path = markdownPath(parent, `${base} ${++suffix}`);
      try {
        await runWithToast(
          (async () => {
            const file = await runtime.client!.createFile({
              vaultId: vault.id,
              path,
              content: "---\ntags: []\n---\n\n",
            });
            await refreshFiles();
            await openDocument(file.path);
            setStatus(`Created note · ${file.path}`);
          })(),
          {
            loading: `Creating ${titleFromPath(path)}…`,
            success: `Created ${titleFromPath(path)}`,
            error: `Could not create ${titleFromPath(path)}`,
          }
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Create note failed");
      }
      return;
    }
    const base = "Untitled";
    let suffix = 0;
    let title = base;
    const titles = new Set(documents.map((document) => document.title));
    while (titles.has(title)) title = `${base} ${++suffix}`;
    const document = { title, content: "---\ntags: []\n---\n\n" };
    const id = nextTabId;
    setNextTabId((current) => current + 1);
    setTabs((current) => [...current, createWorkspaceTab(id, document)]);
    setActiveTabId(id);
    setWorkspaceRoot((root) =>
      mapWorkspaceLeaf(root, activeLeafId, (leaf) => ({
        ...leaf,
        view: "editor",
        tabIds: [...leaf.tabIds, id],
        activeTabId: id,
      }))
    );
  };

  const updateProperty = (key: string, value: string) => {
    if (!activeTab?.document) return;
    updateTab(activeTab.id, (current) =>
      current.document
        ? {
            ...current,
            document: {
              ...current.document,
              content: setFrontmatterProperty(current.document.content, key, value),
            },
          }
        : current
    );
  };

  const popOutTab = (tab: WorkspaceTab) => {
    const url = new URL(window.location.href);
    url.searchParams.set("popout", tab.title);
    if (runtime.openWindow) void runtime.openWindow(url.toString());
    else window.open(url.toString(), "_blank", "popup,width=960,height=720");
  };

  useEffect(() => {
    let active = true;
    const connect = async () => {
      try {
        if (runtime.client) {
          const server = await getBootstrapStatus(runtime.client);
          if (!active) return;
          if (server.openVault) {
            await loadVault(server.openVault);
          } else {
            const lastPath = localStorage.getItem(LAST_VAULT_PATH_KEY);
            if (lastPath) {
              try {
                await loadVault(await runtime.client.openVault({ path: lastPath }));
                return;
              } catch {
                localStorage.removeItem(LAST_VAULT_PATH_KEY);
              }
            }
            setStatus("Go backend connected · no vault open");
            setVaultPickerOpen(true);
          }
        } else {
          const message = await runtime.connect();
          if (active) setStatus(message);
        }
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : "Runtime unavailable");
      }
    };
    void connect();

    return () => {
      active = false;
    };
    // Runtime object is shell-owned and stable; reconnect only when shell changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  const renderWorkspaceLeaf = (leaf: Extract<WorkspaceNode, { kind: "leaf" }>) => {
    const leafTabs = leaf.tabIds
      .map((id) => tabs.find((tab) => tab.id === id))
      .filter((tab): tab is WorkspaceTab => Boolean(tab));
    const leafActiveTab = leafTabs.find((tab) => tab.id === leaf.activeTabId) ?? leafTabs[0];
    const leafTitle =
      leaf.view === "graph"
        ? "Graph view"
        : leaf.view === "pdf"
          ? "PDF viewer"
          : leafActiveTab?.title;
    const soleProtectedNewTab = leafActiveTab ? isProtectedNewTab(leafActiveTab, leaf.id) : false;

    return (
      <div
        data-workspace-active={leaf.id === activeLeafId}
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
        onPointerDownCapture={() => {
          setActiveLeafId(leaf.id);
          if (leafActiveTab) setActiveTabId(leafActiveTab.id);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("application/x-flux-tab")) event.preventDefault();
        }}
        onDrop={(event) => moveTabToLeaf(event, leaf.id)}
      >
        <div
          className={`h-11 shrink-0 bg-[var(--window-chrome-active)] group-data-[window-active=false]/layout:bg-sidebar ${
            leftEdgeLeafIds.has(leaf.id) ? "pl-[var(--flux-titlebar-left-inset)]" : ""
          } ${rightEdgeLeafIds.has(leaf.id) ? "pr-[var(--flux-titlebar-right-inset)]" : ""}`}
        >
          <FluxTabBar
            className="px-2"
            inlineAction={<FluxTabAddButton onClick={addTab} />}
            actions={
              <FluxTabMenu
                tabs={leafTabs.map((tab) => ({
                  id: tab.id,
                  label: tab.title,
                  active: tab.id === leafActiveTab?.id,
                }))}
                stacked={Boolean(leaf.stacked)}
                onStackedChange={(stacked) =>
                  setWorkspaceRoot((root) =>
                    mapWorkspaceLeaf(root, leaf.id, (current) => ({
                      ...current,
                      view: "editor",
                      stacked,
                    }))
                  )
                }
                onCloseAll={closeAllTabs}
                onSelect={(id) => activateLeafTab(leaf.id, Number(id))}
              />
            }
          >
            <LayoutGroup id={`flux-leaf-tabs-${leaf.id}`}>
              <AnimatePresence initial={false}>
                {!leaf.stacked &&
                  leafTabs.map((tab) => (
                    <FluxTabContextMenu key={tab.id} {...commandsFor(tab, leaf.id)}>
                      <FluxTab
                        active={tab.id === leafActiveTab?.id}
                        closeable={
                          !tab.pinned && !(soleProtectedNewTab && tab.id === leafActiveTab?.id)
                        }
                        pinned={tab.pinned}
                        draggable
                        onNativeDragStart={(event) =>
                          markDraggedTab(event, tab.title, tab.id, leaf.id)
                        }
                        onNativeDragEnd={(event) => {
                          if (wasDroppedAtWindowEdge(event)) popOutTab(tab);
                        }}
                        onClick={() => activateLeafTab(leaf.id, tab.id)}
                        onClose={(event) => {
                          event.stopPropagation();
                          closeLeafTab(leaf.id, tab.id);
                        }}
                      >
                        {tab.id === leafActiveTab?.id ? leafTitle : tab.title}
                      </FluxTab>
                    </FluxTabContextMenu>
                  ))}
              </AnimatePresence>
            </LayoutGroup>
          </FluxTabBar>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {leaf.view === "editor" && leaf.stacked && leafTabs.length > 0 ? (
            <div className="flux-stacked-viewport h-full min-h-0 min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-color:color-mix(in_oklab,var(--muted-foreground)_45%,transparent)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:block [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-corner]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_oklab,var(--muted-foreground)_45%,transparent)] [&::-webkit-scrollbar-thumb]:bg-clip-padding [&::-webkit-scrollbar-track]:bg-transparent">
              <LayoutGroup id={`flux-stacked-tabs-${leaf.id}`}>
                <div className="flex h-full w-max min-w-full">
                  <AnimatePresence initial={false}>
                    {leafTabs.map((tab) =>
                      tab.id === leafActiveTab?.id ? (
                        <m.div
                          key={tab.id}
                          layout
                          className="flex h-full min-w-64 flex-1"
                          transition={{
                            layout: { type: "spring", visualDuration: 0.24, bounce: 0.04 },
                          }}
                        >
                          <FluxTabContextMenu {...commandsFor(tab, leaf.id)}>
                            <FluxStackedTab
                              active
                              closeable={!tab.pinned && !isProtectedNewTab(tab, leaf.id)}
                              pinned={tab.pinned}
                              draggable
                              onNativeDragStart={(event) =>
                                markDraggedTab(event, tab.title, tab.id, leaf.id)
                              }
                              onNativeDragEnd={(event) => {
                                if (wasDroppedAtWindowEdge(event)) popOutTab(tab);
                              }}
                              onClick={() => activateLeafTab(leaf.id, tab.id)}
                              onClose={(event) => {
                                event.stopPropagation();
                                closeLeafTab(leaf.id, tab.id);
                              }}
                            >
                              {tab.title}
                            </FluxStackedTab>
                          </FluxTabContextMenu>
                          <div className="min-w-[28rem] flex-1 overflow-hidden">
                            {paneFor(tab, leaf.id)}
                          </div>
                        </m.div>
                      ) : (
                        <FluxTabContextMenu key={tab.id} {...commandsFor(tab, leaf.id)}>
                          <FluxStackedTab
                            closeable={!tab.pinned}
                            pinned={tab.pinned}
                            draggable
                            onNativeDragStart={(event) =>
                              markDraggedTab(event, tab.title, tab.id, leaf.id)
                            }
                            onNativeDragEnd={(event) => {
                              if (wasDroppedAtWindowEdge(event)) popOutTab(tab);
                            }}
                            onClick={() => activateLeafTab(leaf.id, tab.id)}
                            onClose={(event) => {
                              event.stopPropagation();
                              closeLeafTab(leaf.id, tab.id);
                            }}
                          >
                            {tab.title}
                          </FluxStackedTab>
                        </FluxTabContextMenu>
                      )
                    )}
                  </AnimatePresence>
                </div>
              </LayoutGroup>
            </div>
          ) : leaf.view === "graph" ? (
            <GraphView
              documents={documents}
              attachments={fileEntries}
              bookmarked={leafActiveTab?.bookmarked ?? false}
              onBookmarkChange={(bookmarked) => {
                if (leafActiveTab) {
                  updateTab(leafActiveTab.id, (tab) => ({ ...tab, bookmarked }));
                }
              }}
              onOpenDocument={openDocument}
              onSplitRight={() => splitLeaf(leaf.id, "horizontal")}
              onSplitDown={() => splitLeaf(leaf.id, "vertical")}
            />
          ) : leaf.view === "pdf" ? (
            <FluxEditorPane
              title="PDF viewer"
              {...(leafActiveTab ? commandsFor(leafActiveTab, leaf.id) : {})}
            >
              <Suspense
                fallback={
                  <div className="grid h-full place-items-center text-xs text-muted-foreground">
                    Loading PDF…
                  </div>
                }
              >
                {leafActiveTab?.pdf ? (
                  <PdfViewer
                    key={leafActiveTab.pdf.path}
                    title={leafActiveTab.title}
                    data={leafActiveTab.pdf.data}
                  />
                ) : (
                  <div className="grid h-full place-items-center text-xs text-muted-foreground">
                    No PDF selected
                  </div>
                )}
              </Suspense>
            </FluxEditorPane>
          ) : leafActiveTab ? (
            paneFor(leafActiveTab, leaf.id)
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Main area
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={500} skipDelayDuration={150}>
          <FluxLayout
            windowControlsInset={windowControlsInset}
            mainExtendsIntoTitlebar
            leftSidebarHeader={
              <WorkspaceSidebarHeader
                side="left"
                active={leftSidebarPane}
                onChange={setLeftSidebarPane}
                plugins={plugins}
              />
            }
            rightSidebarHeader={
              <WorkspaceSidebarHeader
                side="right"
                active={rightSidebarPane}
                onChange={setRightSidebarPane}
                plugins={plugins}
              />
            }
            stickySidebar={
              <WorkspaceRibbon
                onGraph={() => {
                  if (plugins["graph-view"] !== false) setLeafView(activeLeafId, "graph");
                }}
                onFiles={() => {
                  if (plugins["file-explorer"] !== false) setLeafView(activeLeafId, "editor");
                }}
                onCanvas={() => {
                  if (plugins["canvas"] !== false) openDocument("Canvas");
                }}
                onSettings={() => setSettingsOpen(true)}
                plugins={plugins}
              />
            }
            leftSidebar={
              <WorkspaceLeftSidebar
                activeTitle={visibleActiveTab?.title ?? ""}
                activePath={visibleActiveTab?.document?.path ?? visibleActiveTab?.pdf?.path}
                pane={leftSidebarPane}
                documents={documents}
                onOpenDocument={(path) => void openDocument(path)}
                onOpenPdf={() => setLeafView(activeLeafId, "pdf")}
                onCreateNote={(parent, name) => void createNote(parent, name)}
                vaultEntries={vault ? fileEntries : undefined}
                onCreateFolder={(parent, name) => void createFolder(parent, name)}
                onMovePath={(source, destination) => void movePath(source, destination)}
                onRenamePath={renamePath}
                onDeletePath={(path) => void deletePath(path)}
                onArchivePath={(path) => void archivePath(path)}
                onOpenTrash={() => void openTrash()}
                onPreviewPath={async (path) => {
                  if (!runtime.client || !vault) return null;
                  return (await runtime.client.readFile(vault.id, path)).content;
                }}
              />
            }
            main={<WorkspaceTree node={workspaceRoot} renderLeaf={renderWorkspaceLeaf} />}
            rightSidebar={
              <WorkspaceRightSidebar
                pane={rightSidebarPane}
                activeDocument={visibleActiveTab?.document ?? null}
                documents={documents}
                onOpenDocument={openDocument}
                onPropertyChange={updateProperty}
                onAddProperty={() => addProperty(activeTabId)}
              />
            }
            footer={
              <FluxStatusBar
                activeVaultId={activeVaultId}
                vaults={
                  vault ? [{ id: vault.id, label: vault.name }] : [{ id: "", label: "No vault" }]
                }
                onVaultChange={setActiveVaultId}
                onManageVaults={() => setVaultPickerOpen(true)}
                version="FLUX 0.0.1"
                updateStatus="Up to date"
                gitStatus="Git · Clean"
                connectionStatus={status}
                characters={visibleActiveTab?.document?.content.length ?? 0}
                words={
                  visibleActiveTab?.document?.content.trim().split(/\s+/).filter(Boolean).length ??
                  0
                }
                backlinks={backlinksCount}
                cpuPercent={performanceStats?.cpuPercent}
                memoryMB={performanceStats?.memoryMB}
                themeControl={
                  <ModeToggle className="-mr-2 size-7 rounded-none border-0 bg-transparent shadow-none hover:bg-accent/60 dark:bg-transparent" />
                }
              />
            }
            leftSidebarOptions={{ defaultWidth: 260, minWidth: 200, maxWidth: 480 }}
            rightSidebarOptions={{ defaultWidth: 280, minWidth: 220, maxWidth: 480 }}
            storageKey="flux-app-layout"
          />
          {vaultPickerOpen ? (
            <div className="fixed inset-0 z-[180] grid place-items-center bg-black/45 p-4">
              <div className="w-full max-w-sm rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl [border-color:var(--layout-separator)]">
                <h2 className="text-base font-semibold">Choose a vault</h2>
                <p className="mt-2 text-sm leading-5 text-muted-foreground">
                  Open any notes folder, Obsidian vault, Git repository, or empty directory. FLUX
                  stores derived state inside that vault’s hidden .flux folder.
                </p>
                <div className="mt-5 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => void chooseVault("open")}
                    className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                  >
                    Open existing vault…
                  </button>
                  <button
                    type="button"
                    onClick={() => void chooseVault("create")}
                    className="rounded-md border px-3 py-2 text-sm hover:bg-accent [border-color:var(--layout-separator)]"
                  >
                    Create new vault…
                  </button>
                  {vault ? (
                    <button
                      type="button"
                      onClick={() => setVaultPickerOpen(false)}
                      className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                  ) : null}
                  {renameRequest ? (
                    <div className="fixed inset-0 z-[190] grid place-items-center bg-black/35 p-4">
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          renamePath(renameRequest.path, renameRequest.value);
                          setRenameRequest(undefined);
                        }}
                        className="w-full max-w-sm rounded-xl border bg-popover p-5 shadow-2xl [border-color:var(--layout-separator)]"
                      >
                        <label htmlFor="document-rename" className="text-sm font-semibold">
                          Rename file
                        </label>
                        <input
                          id="document-rename"
                          autoFocus
                          value={renameRequest.value}
                          onChange={(event) =>
                            setRenameRequest({ ...renameRequest, value: event.target.value })
                          }
                          className="mt-3 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50 [border-color:var(--layout-separator)]"
                        />
                        <div className="mt-4 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setRenameRequest(undefined)}
                            className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                          >
                            Rename
                          </button>
                        </div>
                      </form>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
          {trashOpen ? (
            <div className="fixed inset-0 z-[180] grid place-items-center bg-black/45 p-4">
              <div className="flex max-h-[min(36rem,80vh)] w-full max-w-lg flex-col rounded-xl border bg-popover text-popover-foreground shadow-2xl [border-color:var(--layout-separator)]">
                <div className="flex items-start justify-between gap-4 border-b p-5 [border-color:var(--layout-separator)]">
                  <div>
                    <h2 className="text-base font-semibold">Trash</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Restore items or permanently delete them.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTrashOpen(false)}
                    className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    Close
                  </button>
                </div>
                <div className="min-h-32 overflow-y-auto p-3">
                  {trashEntries.length ? (
                    <div className="space-y-1">
                      {trashEntries.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent/50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{entry.originalPath}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              Deleted {new Date(entry.deletedAt).toLocaleString()} ·{" "}
                              {entry.sizeBytes.toLocaleString()} bytes
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void restoreTrashEntry(entry)}
                            className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent [border-color:var(--layout-separator)]"
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={() => setPermanentDeleteRequest(entry)}
                            className="rounded-md px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                          >
                            Delete permanently
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid min-h-32 place-items-center text-sm text-muted-foreground">
                      Trash is empty.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
          {permanentDeleteRequest ? (
            <div className="fixed inset-0 z-[200] grid place-items-center bg-black/55 p-4">
              <div className="w-full max-w-sm rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl [border-color:var(--layout-separator)]">
                <h2 className="text-base font-semibold">Permanently delete?</h2>
                <p className="mt-3 text-sm leading-5 text-muted-foreground">
                  This permanently deletes{" "}
                  <span className="font-medium text-foreground">
                    {permanentDeleteRequest.originalPath}
                  </span>
                  . This cannot be undone.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPermanentDeleteRequest(undefined)}
                    className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void permanentlyDeleteTrashEntry(permanentDeleteRequest)}
                    className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground"
                  >
                    Delete permanently
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <PdfExportDialog
            document={pdfExportDocument}
            documents={documents}
            open={pdfExportOpen}
            onOpenChange={setPdfExportOpen}
            onExport={runtime.exportPdf}
          />
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            vaultName={vault?.name}
          />
          <Toaster />
        </TooltipProvider>
      </MotionConfig>
    </LazyMotion>
  );
}
