import { expect, mock, test } from "bun:test";
import { WebFluxClient } from "../src";

test("uses canonical status route", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = mock(async () =>
    Response.json({
      status: "healthy",
      version: "0.0.1",
      vaultConfigured: false,
      openVault: null,
    })
  );
  globalThis.fetch = fetchMock as typeof fetch;

  try {
    const client = new WebFluxClient();
    await client.getStatus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/status", {
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("handles confirmed permanent deletion with an empty response", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = mock(async () => new Response(null, { status: 204 }));
  globalThis.fetch = fetchMock as typeof fetch;

  try {
    const client = new WebFluxClient();
    await expect(client.permanentlyDelete("vault/id", "trash/id")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/vaults/vault%2Fid/trash/trash%2Fid?confirm=true",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reads watcher revision", async () => {
  const fetchMock = mock(async () => Response.json({ revision: 7 }));
  const client = new WebFluxClient("/api/v1", fetchMock as typeof fetch);

  await expect(client.getVaultRevision("vault/id")).resolves.toBe(7);
  expect(fetchMock).toHaveBeenCalledWith("/api/v1/vaults/vault%2Fid/revision", {
    headers: { "Content-Type": "application/json" },
  });
});

test("reads raw binary file", async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  const fetchMock = mock(async () => new Response(bytes));
  const client = new WebFluxClient("/api/v1", fetchMock as typeof fetch);

  const result = new Uint8Array(await client.readBinaryFile("vault/id", "folder/test.pdf"));
  expect(result).toEqual(bytes);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/vaults/vault%2Fid/files/raw?path=folder%2Ftest.pdf"
  );
});
