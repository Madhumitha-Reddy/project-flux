import type { ReactNode } from "react";
import { Check, ChevronsUpDown, GitBranch, Settings2, Vault } from "lucide-react";
import { DropdownMenu } from "radix-ui";

export interface FluxVaultOption {
  id: string;
  label: string;
}

export interface FluxStatusBarProps {
  activeVaultId: string;
  vaults: FluxVaultOption[];
  onVaultChange: (id: string) => void;
  onManageVaults?: () => void;
  version: string;
  updateStatus: string;
  gitStatus: string;
  connectionStatus: string;
  characters: number;
  words: number;
  backlinks: number;
  cpuPercent?: number;
  memoryMB?: number;
  themeControl?: ReactNode;
}

function StatusSeparator() {
  return <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-[var(--layout-separator)]" />;
}

export function FluxStatusBar({
  activeVaultId,
  vaults,
  onVaultChange,
  onManageVaults,
  version,
  updateStatus,
  gitStatus,
  connectionStatus,
  characters,
  words,
  backlinks,
  cpuPercent,
  memoryMB,
  themeControl,
}: FluxStatusBarProps) {
  const activeVault = vaults.find((vault) => vault.id === activeVaultId) ?? vaults[0];

  return (
    <div className="grid h-full w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="Switch vault"
              className="flex h-7 min-w-0 max-w-48 items-center gap-1.5 rounded-sm px-1.5 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 data-[state=open]:bg-accent data-[state=open]:text-foreground"
            >
              <Vault className="size-3.5 shrink-0" />
              <span className="truncate font-medium text-foreground">
                {activeVault?.label ?? "Vault"}
              </span>
              <ChevronsUpDown className="size-3 shrink-0 opacity-60" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="start"
              sideOffset={6}
              className="z-[110] min-w-56 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg [border-color:var(--layout-separator)]"
            >
              {vaults.map((vault) => (
                <DropdownMenu.Item
                  key={vault.id}
                  onSelect={() => onVaultChange(vault.id)}
                  className="relative flex h-8 cursor-default select-none items-center rounded-md px-2 pr-8 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                >
                  <span className="truncate">{vault.label}</span>
                  {vault.id === activeVaultId ? (
                    <Check className="absolute right-2 size-4" />
                  ) : null}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Separator className="my-1 h-px bg-[var(--layout-separator)]" />
              <DropdownMenu.Item
                disabled={!onManageVaults}
                onSelect={onManageVaults}
                className="flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <Settings2 className="size-4 text-muted-foreground" />
                Manage vaults…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <StatusSeparator />
        <span className="truncate" title={`${version} · ${updateStatus}`}>
          {version} · {updateStatus}
        </span>
        <StatusSeparator />
        <span className="flex shrink-0 items-center gap-1" title="Git plugin status">
          <GitBranch className="size-3.5" />
          {gitStatus}
        </span>
      </div>

      <span className="max-w-64 truncate px-2 text-center" title={connectionStatus}>
        {connectionStatus}
      </span>

      <div className="flex min-w-0 items-center justify-end gap-2 whitespace-nowrap">
        <span className="truncate">
          {characters.toLocaleString()} characters, {words.toLocaleString()} words,{" "}
          {backlinks.toLocaleString()} backlinks
        </span>
        <StatusSeparator />
        {cpuPercent !== undefined && memoryMB !== undefined ? (
          <>
            <span
              className="shrink-0 tabular-nums"
              title="Total CPU and working memory used by FLUX processes"
            >
              CPU {cpuPercent.toFixed(1)}% · {Math.round(memoryMB).toLocaleString()} MB
            </span>
            <StatusSeparator />
          </>
        ) : null}
        {themeControl}
      </div>
    </div>
  );
}
