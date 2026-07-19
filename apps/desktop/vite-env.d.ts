/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    ping: () => Promise<string>;
    checkForUpdates: () => Promise<{
      isDev: boolean;
      isPackaged: boolean;
      error?: string;
    }>;
    getAppVersion: () => Promise<string>;
    getPerformanceStats: () => Promise<{
      cpuPercent: number;
      memoryMB: number;
    }>;
    setTheme: (theme: "dark" | "light" | "system") => Promise<void>;
    openWindow: (url: string) => Promise<void>;
    exportPdf: (options: {
      title: string;
      pageSize: "A4" | "Letter";
      landscape: boolean;
      marginMillimetres: number;
      scale: number;
    }) => Promise<string | null>;
    selectVaultDirectory: (mode: "open" | "create") => Promise<string | null>;
    fluxFetch: (request: {
      url: string;
      method?: string;
      body?: string;
    }) => Promise<{ status: number; body: string; bodyBase64?: string; contentType: string }>;
    watchVaultRevision: (
      vaultId: string,
      onRevision: (revision: number) => void,
      onError?: (message: string) => void
    ) => () => void;
  };
}
