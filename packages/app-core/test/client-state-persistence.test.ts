import { describe, expect, mock, test } from "bun:test";
import type { FluxClient } from "@flux/bridge-contract";

import { createClientStatePersistence } from "../src/client-state-persistence";

describe("client state persistence", () => {
  test("restores last window vault and validates workspace state", async () => {
    const client = {
      getBootstrap: mock(async () => ({
        recentVaults: [
          {
            vaultId: "other",
            path: "/vaults/other",
            displayName: "Other",
            lastOpenedAt: "2026-07-20T00:00:00Z",
          },
          {
            vaultId: "notes",
            path: "/vaults/notes",
            displayName: "Notes",
            lastOpenedAt: "2026-07-19T00:00:00Z",
          },
        ],
        workspace: {
          windowId: "main",
          vaultId: "notes",
          state: {},
          updatedAt: "2026-07-21T00:00:00Z",
        },
        settings: {},
      })),
      getWorkspace: mock(async () => ({
        windowId: "main",
        vaultId: "notes",
        state: { version: 999 },
        updatedAt: "2026-07-21T00:00:00Z",
      })),
    } as unknown as FluxClient;
    const persistence = createClientStatePersistence(client);

    await expect(persistence.loadBootstrap("main")).resolves.toEqual({
      lastVaultPath: "/vaults/notes",
    });
    await expect(persistence.loadWorkspaceSession("main", "notes")).resolves.toBeNull();
  });
});
