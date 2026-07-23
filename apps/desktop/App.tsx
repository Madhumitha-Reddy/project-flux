import { createClientStatePersistence, FluxApp, type FluxRuntime } from "@flux/app-core";
import { DesktopFluxClient } from "@flux/client-desktop";

const client = window.electronAPI ? new DesktopFluxClient(window.electronAPI) : null;
const statePersistence = client ? createClientStatePersistence(client) : undefined;

const desktopRuntime: FluxRuntime = {
  label: "Desktop",
  client,
  statePersistence,
  getWindowId: async () => window.electronAPI?.getWindowId() ?? "main",
  setTheme: async (theme) => {
    await window.electronAPI?.setTheme(theme);
  },
  connect: async () => {
    if (!window.electronAPI) return "Electron bridge unavailable";
    const response = await window.electronAPI.ping();
    return response === "pong" ? "Electron bridge connected" : response;
  },
  getPerformanceStats: async () => window.electronAPI?.getPerformanceStats() ?? null,
  openWindow: async (url) => window.electronAPI?.openWindow(url),
  onBeforeShutdown: (handler) => window.electronAPI?.onBeforeClose(handler) ?? (() => undefined),
  exportPdf: async (options) => window.electronAPI?.exportPdf(options) ?? null,
  selectVaultDirectory: async (mode) => window.electronAPI?.selectVaultDirectory(mode) ?? null,
};

export default function App() {
  return <FluxApp runtime={desktopRuntime} />;
}
