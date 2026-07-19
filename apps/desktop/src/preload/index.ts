import { contextBridge, ipcRenderer } from "electron";

let nextWatcherId = 0;

contextBridge.exposeInMainWorld("electronAPI", {
  ping: () => ipcRenderer.invoke("ping"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPerformanceStats: () => ipcRenderer.invoke("get-performance-stats"),
  setTheme: (theme: "dark" | "light" | "system") => ipcRenderer.invoke("set-native-theme", theme),
  openWindow: (url: string) => ipcRenderer.invoke("open-window", url),
  exportPdf: (options: {
    title: string;
    pageSize: "A4" | "Letter";
    landscape: boolean;
    marginMillimetres: number;
    scale: number;
  }) => ipcRenderer.invoke("export-pdf", options),
  selectVaultDirectory: (mode: "open" | "create") =>
    ipcRenderer.invoke("select-vault-directory", mode),
  fluxFetch: (request: { url: string; method?: string; body?: string }) =>
    ipcRenderer.invoke("flux-fetch", request),
  watchVaultRevision: (
    vaultId: string,
    onRevision: (revision: number) => void,
    onError?: (message: string) => void
  ) => {
    const watcherId = `${Date.now()}-${++nextWatcherId}`;
    const revisionChannel = `vault-revision:${watcherId}`;
    const errorChannel = `vault-revision-error:${watcherId}`;
    const handleRevision = (_event: Electron.IpcRendererEvent, revision: number) =>
      onRevision(revision);
    const handleError = (_event: Electron.IpcRendererEvent, message: string) => onError?.(message);
    ipcRenderer.on(revisionChannel, handleRevision);
    ipcRenderer.on(errorChannel, handleError);
    ipcRenderer.send("watch-vault-revision", { watcherId, vaultId });
    return () => {
      ipcRenderer.off(revisionChannel, handleRevision);
      ipcRenderer.off(errorChannel, handleError);
      ipcRenderer.send("unwatch-vault-revision", watcherId);
    };
  },
});
