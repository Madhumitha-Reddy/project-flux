export const pluginCapabilities = [
  "vault.read",
  "vault.write",
  "vault.move",
  "vault.delete",
  "vault.search",
  "documents.parse",
  "tasks.query",
  "tasks.update",
  "ui.command",
  "ui.view",
  "network.fetch",
  "background.run",
  "git.status",
  "git.commit",
] as const;

export type PluginCapability = (typeof pluginCapabilities)[number];

export type PluginActivationEvent = "onVaultOpen" | `onCommand:${string}` | `onFileType:${string}`;

export interface PluginCommandContribution {
  id: string;
  title: string;
}

export interface PluginViewContribution {
  id: string;
  title: string;
  entry: string;
}

export type PluginSettingContribution =
  | { id: string; title: string; description?: string; type: "string"; default?: string }
  | { id: string; title: string; description?: string; type: "number"; default?: number }
  | { id: string; title: string; description?: string; type: "boolean"; default?: boolean };

export interface PluginManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  publisher?: string;
  entry: string;
  activationEvents?: PluginActivationEvent[];
  requiredPermissions?: PluginCapability[];
  optionalPermissions?: PluginCapability[];
  contributes?: {
    commands?: PluginCommandContribution[];
    views?: PluginViewContribution[];
    settings?: PluginSettingContribution[];
  };
}

export interface CapabilityDefinitions {
  "vault.read": {
    input: { path: string };
    output: { path: string; content: string; contentHash: string };
  };
  "vault.write": {
    input: { path: string; content: string; expectedHash?: string };
    output: { path: string; contentHash: string };
  };
  "vault.move": {
    input: { from: string; to: string; expectedHash?: string };
    output: { path: string };
  };
  "vault.delete": {
    input: { path: string; expectedHash?: string };
    output: { path: string };
  };
  "vault.search": {
    input: { query: string; limit?: number };
    output: { results: Array<{ path: string; title: string; excerpt: string }> };
  };
  "documents.parse": { input: { path: string }; output: unknown };
  "tasks.query": { input: { query?: string }; output: unknown };
  "tasks.update": { input: unknown; output: unknown };
  "ui.command": { input: unknown; output: unknown };
  "ui.view": { input: unknown; output: unknown };
  "network.fetch": {
    input: { url: string; method?: string; headers?: Record<string, string>; body?: string };
    output: { status: number; headers: Record<string, string>; body: string };
  };
  "background.run": { input: unknown; output: unknown };
  "git.status": { input: Record<string, never>; output: unknown };
  "git.commit": { input: { message: string; paths?: string[] }; output: unknown };
}

export interface PluginCapabilityClient {
  has(capability: PluginCapability): boolean;
  invoke<K extends keyof CapabilityDefinitions>(
    capability: K,
    input: CapabilityDefinitions[K]["input"]
  ): Promise<CapabilityDefinitions[K]["output"]>;
}

export interface PluginSettings {
  get<T = unknown>(id: string): T | undefined;
  all(): Readonly<Record<string, unknown>>;
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly vaultId: string;
  readonly signal: AbortSignal;
  readonly capabilities: PluginCapabilityClient;
  readonly settings: PluginSettings;
  on(event: string, listener: (payload: unknown) => void | Promise<void>): () => void;
}

export interface FluxPlugin {
  activate(context: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export function definePlugin<T extends FluxPlugin>(plugin: T): T {
  const register = (
    globalThis as typeof globalThis & {
      __fluxRegisterPlugin?: (candidate: FluxPlugin) => void;
    }
  ).__fluxRegisterPlugin;
  if (typeof register === "function") register(plugin);
  return plugin;
}
