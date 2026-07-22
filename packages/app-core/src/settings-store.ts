import { useState, useEffect } from "react";

export interface GeneralSettings {
  launchBehaviour: "last-vault" | "empty" | "vault-picker";
  confirmDeleteNote: boolean;
  autoSave: boolean;
  autoSaveDelay: number;
  defaultStartupPage: "last-active" | "files" | "graph" | "daily-note";
  showInlineTitle: boolean;
  showTabBar: boolean;
}

export interface EditorSettings {
  livePreview: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  spellCheck: boolean;
  autoPairBrackets: boolean;
  fontSize: number;
  tabSize: number;
  vimBindings: boolean;
}

export interface AppearanceSettings {
  theme: "dark" | "light" | "system";
  accentColor: string;
  sidebarDensity: "compact" | "comfortable" | "spacious";
  fontScaling: number;
}

export interface KeychainEntry {
  id: string;
  name: string;
  service: string;
  key: string;
  status: "configured" | "not-set";
  createdAt: string;
}

export interface FluxSettings {
  general: GeneralSettings;
  editor: EditorSettings;
  appearance: AppearanceSettings;
  keychain: KeychainEntry[];
  plugins: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: FluxSettings = {
  general: {
    launchBehaviour: "last-vault",
    confirmDeleteNote: true,
    autoSave: true,
    autoSaveDelay: 3,
    defaultStartupPage: "last-active",
    showInlineTitle: true,
    showTabBar: true,
  },
  editor: {
    livePreview: true,
    wordWrap: true,
    lineNumbers: true,
    spellCheck: true,
    autoPairBrackets: true,
    fontSize: 16,
    tabSize: 4,
    vimBindings: false,
  },
  appearance: {
    theme: "system",
    accentColor: "default",
    sidebarDensity: "comfortable",
    fontScaling: 100,
  },
  keychain: [
    {
      id: "openai",
      name: "OpenAI API Key",
      service: "openai",
      key: "sk-proj-••••••••9823",
      status: "configured",
      createdAt: "2026-07-01",
    },
    {
      id: "github",
      name: "GitHub Token",
      service: "github",
      key: "ghp_••••••••4192",
      status: "configured",
      createdAt: "2026-07-10",
    },
    {
      id: "anthropic",
      name: "Anthropic API Key",
      service: "anthropic",
      key: "",
      status: "not-set",
      createdAt: "",
    },
  ],
  plugins: {
    "file-explorer": true,
    search: true,
    "graph-view": true,
    bookmarks: true,
    "live-preview": true,
    canvas: true,
    "ai-chat": true,
    backlinks: true,
    "command-palette": true,
    "daily-notes": true,
    "file-recovery": true,
    "note-composer": true,
    "page-preview": true,
    "quick-switcher": true,
    sync: true,
    templates: true,
    outline: true,
    properties: true,
    "word-count": true,
  },
};

const STORAGE_KEY = "flux-app-settings-v1";
const CHANGE_EVENT = "flux-settings-changed";

export function loadSettings(): FluxSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      general: { ...DEFAULT_SETTINGS.general, ...parsed.general },
      editor: { ...DEFAULT_SETTINGS.editor, ...parsed.editor },
      appearance: { ...DEFAULT_SETTINGS.appearance, ...parsed.appearance },
      keychain: parsed.keychain ?? DEFAULT_SETTINGS.keychain,
      plugins: { ...DEFAULT_SETTINGS.plugins, ...parsed.plugins },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: FluxSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new Event(CHANGE_EVENT));
  applyAppearanceSettings(settings.appearance);
}

export function applyAppearanceSettings(appearance: AppearanceSettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  if (appearance.accentColor && appearance.accentColor !== "default") {
    root.style.setProperty("--primary", appearance.accentColor);
  } else {
    root.style.removeProperty("--primary");
  }

  const densityPaddingMap: Record<string, string> = {
    compact: "0.25rem",
    comfortable: "0.5rem",
    spacious: "0.75rem",
  };
  root.style.setProperty("--sidebar-density-padding", densityPaddingMap[appearance.sidebarDensity] || "0.5rem");

  if (appearance.fontScaling && appearance.fontScaling !== 100) {
    root.style.fontSize = `${(appearance.fontScaling / 100) * 100}%`;
  } else {
    root.style.fontSize = "";
  }
}

export function useFluxSettings() {
  const [settings, setSettingsState] = useState<FluxSettings>(() => loadSettings());

  useEffect(() => {
    applyAppearanceSettings(settings.appearance);
    const handler = () => {
      setSettingsState(loadSettings());
    };
    window.addEventListener(CHANGE_EVENT, handler);
    return () => window.removeEventListener(CHANGE_EVENT, handler);
  }, []);

  const updateSettings = (updater: (prev: FluxSettings) => FluxSettings) => {
    const next = updater(loadSettings());
    saveSettings(next);
    setSettingsState(next);
  };

  return { settings, updateSettings };
}
