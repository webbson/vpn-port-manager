import { describe, it, expect, vi } from "vitest";
import { listDanglingPorts } from "../../src/services/dangling-ports.js";
import { createDb } from "../../src/db.js";
import type { VpnProvider } from "../../src/providers/types.js";

function mockProvider(ports: { port: number; expiresAt: number }[]): VpnProvider {
  return {
    name: "azire",
    maxPorts: 5,
    listPorts: vi.fn().mockResolvedValue(ports),
    createPort: vi.fn(),
    deletePort: vi.fn(),
    checkPort: vi.fn(),
  };
}

describe("listDanglingPorts", () => {
  it("returns provider ports not tracked in the DB", async () => {
    const db = createDb(":memory:");
    db.createMapping({
      provider: "azire",
      vpnPort: 1001,
      destIp: "10.0.0.1",
      destPort: 22,
      protocol: "tcp",
      label: "tracked",
      status: "active",
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
    });

    const provider = mockProvider([
      { port: 1001, expiresAt: 9999 },
      { port: 2002, expiresAt: 9999 },
      { port: 3003, expiresAt: 9999 },
    ]);

    const dangling = await listDanglingPorts(provider, db);
    expect(dangling.map((p) => p.port).sort()).toEqual([2002, 3003]);
  });

  it("treats expired mappings as untracked so their ports surface if still at provider", async () => {
    const db = createDb(":memory:");
    const id = db.createMapping({
      provider: "azire",
      vpnPort: 4004,
      destIp: "10.0.0.1",
      destPort: 22,
      protocol: "tcp",
      label: "old",
      status: "active",
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
    });
    db.updateMapping(id, { status: "expired" });

    const provider = mockProvider([{ port: 4004, expiresAt: 9999 }]);
    const dangling = await listDanglingPorts(provider, db);
    expect(dangling.map((p) => p.port)).toEqual([4004]);
  });

  it("returns empty when provider list is empty", async () => {
    const db = createDb(":memory:");
    const provider = mockProvider([]);
    expect(await listDanglingPorts(provider, db)).toEqual([]);
  });
});
