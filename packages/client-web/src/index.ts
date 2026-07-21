import type {
  AppBootstrap,
  CreateFileRequest,
  FileDocument,
  FileEntry,
  FluxClient,
  MoveFileRequest,
  OpenVaultRequest,
  PatchFileRequest,
  PurgeResult,
  RecentVault,
  SaveFileRequest,
  SaveResult,
  ServerStatus,
  TrashEntry,
  TrashRetentionDays,
  VaultInfo,
  VaultGraph,
  VaultChange,
  VaultLocation,
  WorkspaceSession,
} from "@flux/bridge-contract";

export class FluxClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "FluxClientError";
  }
}

export type FluxFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class WebFluxClient implements FluxClient {
  constructor(
    private readonly baseURL = "/api/v1",
    private readonly fetcher: FluxFetch = (input, init) => globalThis.fetch(input, init)
  ) {}

  getStatus() {
    return this.request<ServerStatus>("/status");
  }

  getBootstrap(windowId: string) {
    const query = new URLSearchParams({ windowId });
    return this.request<AppBootstrap>(`/bootstrap?${query.toString()}`);
  }

  listRecentVaults() {
    return this.request<RecentVault[]>("/recent-vaults");
  }

  listAvailableVaults() {
    return this.request<VaultLocation[]>("/vaults/available");
  }

  rememberVault(vault: Pick<RecentVault, "vaultId" | "path" | "displayName">) {
    return this.request<void>(`/recent-vaults/${encodeURIComponent(vault.vaultId)}`, {
      method: "PUT",
      body: JSON.stringify({ path: vault.path, displayName: vault.displayName }),
    });
  }

  forgetVault(vaultId: string) {
    return this.request<void>(`/recent-vaults/${encodeURIComponent(vaultId)}`, {
      method: "DELETE",
    });
  }

  async getWorkspace(windowId: string, vaultId?: string) {
    const query = new URLSearchParams();
    if (vaultId) query.set("vaultId", vaultId);
    try {
      return await this.request<WorkspaceSession>(
        `/workspace-sessions/${encodeURIComponent(windowId)}${query.size ? `?${query}` : ""}`
      );
    } catch (error) {
      if (error instanceof FluxClientError && error.status === 404) return null;
      throw error;
    }
  }

  saveWorkspace(windowId: string, vaultId: string, state: unknown) {
    return this.request<void>(`/workspace-sessions/${encodeURIComponent(windowId)}`, {
      method: "PUT",
      body: JSON.stringify({ vaultId, state }),
    });
  }

  getAppSettings() {
    return this.request<Record<string, unknown>>("/app-settings");
  }

  putAppSetting(key: string, value: unknown) {
    return this.request<void>(`/app-settings/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  }

  openVault(request: OpenVaultRequest = {}) {
    return this.request<VaultInfo>("/vaults/open", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  createVault(request: Required<OpenVaultRequest>) {
    return this.request<VaultInfo>("/vaults/create", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async getVaultRevision(vaultId: string) {
    const result = await this.request<{ revision: number }>(
      `/vaults/${encodeURIComponent(vaultId)}/revision`
    );
    return result.revision;
  }

  watchVaultRevision(
    vaultId: string,
    onRevision: (revision: number) => void,
    onError?: (error: Error) => void
  ) {
    return this.watchVaultChanges(vaultId, (change) => onRevision(change.revision), onError);
  }

  watchVaultChanges(
    vaultId: string,
    onChange: (change: VaultChange) => void,
    onError?: (error: Error) => void
  ) {
    const source = new EventSource(`${this.baseURL}/vaults/${encodeURIComponent(vaultId)}/events`);
    source.addEventListener("revision", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as VaultChange;
        if (typeof payload.revision === "number") onChange(payload);
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    });
    source.onerror = () => onError?.(new Error("Vault event stream disconnected"));
    return () => source.close();
  }

  listFiles(vaultId: string) {
    return this.request<FileEntry[]>(`/vaults/${encodeURIComponent(vaultId)}/files`);
  }

  getGraph(vaultId: string) {
    return this.request<VaultGraph>(`/vaults/${encodeURIComponent(vaultId)}/graph`);
  }

  async getFileMetadata(vaultId: string, path: string) {
    const query = new URLSearchParams({ path });
    try {
      return await this.request<FileEntry>(
        `/vaults/${encodeURIComponent(vaultId)}/files/metadata?${query.toString()}`
      );
    } catch (error) {
      if (error instanceof FluxClientError && error.status === 404) return null;
      throw error;
    }
  }

  rebuildIndex(vaultId: string) {
    return this.request<void>(`/vaults/${encodeURIComponent(vaultId)}/index/rebuild`, {
      method: "POST",
    });
  }

  createDirectory(vaultId: string, path: string) {
    return this.request<FileEntry>(`/vaults/${encodeURIComponent(vaultId)}/directories`, {
      method: "POST",
      body: JSON.stringify({ path }),
    });
  }

  createFile(request: CreateFileRequest) {
    const { vaultId, ...body } = request;
    return this.request<FileDocument>(`/vaults/${encodeURIComponent(vaultId)}/files`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  readFile(vaultId: string, path: string) {
    const query = new URLSearchParams({ path });
    return this.request<FileDocument>(
      `/vaults/${encodeURIComponent(vaultId)}/files/content?${query.toString()}`
    );
  }

  async readBinaryFile(vaultId: string, path: string) {
    const query = new URLSearchParams({ path });
    const response = await this.fetcher(
      `${this.baseURL}/vaults/${encodeURIComponent(vaultId)}/files/raw?${query.toString()}`
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      throw new FluxClientError(
        body?.error ?? `Flux request failed with status ${response.status}`,
        response.status,
        body?.code
      );
    }
    return response.arrayBuffer();
  }

  saveFile(request: SaveFileRequest) {
    const { vaultId, ...body } = request;
    return this.request<SaveResult>(`/vaults/${encodeURIComponent(vaultId)}/files/content`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  patchFile(request: PatchFileRequest) {
    const { vaultId, ...body } = request;
    return this.request<SaveResult>(`/vaults/${encodeURIComponent(vaultId)}/files/content`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  moveFile(request: MoveFileRequest) {
    const { vaultId, ...body } = request;
    return this.request<FileEntry>(`/vaults/${encodeURIComponent(vaultId)}/files/move`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  deleteFile(vaultId: string, path: string) {
    const query = new URLSearchParams({ path });
    return this.request<TrashEntry>(
      `/vaults/${encodeURIComponent(vaultId)}/files?${query.toString()}`,
      { method: "DELETE" }
    );
  }

  restoreFile(vaultId: string, trashId: string) {
    return this.request<FileEntry>(`/vaults/${encodeURIComponent(vaultId)}/files/restore`, {
      method: "POST",
      body: JSON.stringify({ trashId }),
    });
  }

  listTrash(vaultId: string) {
    return this.request<TrashEntry[]>(`/vaults/${encodeURIComponent(vaultId)}/trash`);
  }

  permanentlyDelete(vaultId: string, trashId: string) {
    return this.request<void>(
      `/vaults/${encodeURIComponent(vaultId)}/trash/${encodeURIComponent(trashId)}?confirm=true`,
      { method: "DELETE" }
    );
  }

  purgeTrash(vaultId: string, retentionDays: TrashRetentionDays) {
    const query = new URLSearchParams({
      olderThanDays: String(retentionDays),
      confirm: "true",
    });
    return this.request<PurgeResult>(
      `/vaults/${encodeURIComponent(vaultId)}/trash?${query.toString()}`,
      { method: "DELETE" }
    );
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    return this.requestURL<T>(`${this.baseURL}${path}`, init);
  }

  private async requestURL<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      throw new FluxClientError(
        body?.error ?? `Flux request failed with status ${response.status}`,
        response.status,
        body?.code
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
