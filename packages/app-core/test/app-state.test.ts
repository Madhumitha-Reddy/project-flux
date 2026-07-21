import { beforeEach, describe, expect, test } from "bun:test";

import { browserStatePersistence, useAppStore } from "../src/app-state";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});

describe("app state", () => {
  beforeEach(() => {
    values.clear();
    useAppStore.setState({
      hydrated: false,
      vaultId: null,
      vaultName: null,
      lifecycle: "initializing",
      indexing: null,
      workspace: null,
      settings: {},
    });
  });

  test("tracks lifecycle progress without vault contents", () => {
    useAppStore.getState().setVault({ id: "vault-1", name: "Notes" }, "indexing", {
      phase: "markdown",
      processed: 4,
      total: 10,
      failed: 0,
    });

    expect(useAppStore.getState()).toMatchObject({
      vaultId: "vault-1",
      lifecycle: "indexing",
      indexing: { processed: 4, total: 10 },
    });
    expect(useAppStore.getState()).not.toHaveProperty("documents");
  });

  test("migrates legacy per-vault tab sessions", async () => {
    values.set(
      "flux-vault-session:vault-1",
      JSON.stringify({
        tabs: [{ path: "Notes/One.md", mode: "read", pinned: true }],
        activePath: "Notes/One.md",
      })
    );

    const session = await browserStatePersistence.loadWorkspaceSession("main", "vault-1");

    expect(session).toMatchObject({
      version: 1,
      vaultId: "vault-1",
      activePath: "Notes/One.md",
      tabs: [{ id: 1, path: "Notes/One.md", mode: "read", pinned: true }],
      workspaceRoot: { kind: "leaf", tabIds: [1], activeTabId: 1 },
    });
  });
});
