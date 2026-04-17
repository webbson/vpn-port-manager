import { describe, it, expect, beforeEach, vi } from "vitest";
import { createDb } from "../src/db.js";
import type { Db } from "../src/db.js";
import type { VpnProvider } from "../src/providers/types.js";
import type { RouterClient } from "../src/routers/types.js";
import { createSyncWatchdog } from "../src/sync.js";

function mockProvider(ports: { port: number; expiresAt: number }[] = []): VpnProvider {
  return {
    name: "azire",
    maxPorts: 5,
    listPorts: vi.fn().mockResolvedValue(ports),
    createPort: vi.fn().mockResolvedValue({ port: 60000, expiresAt: 9999999999 }),
    deletePort: vi.fn().mockResolvedValue(undefined),
    checkPort: vi.fn().mockResolvedValue(true),
  };
}

function mockRouter(): RouterClient {
  return {
    name: "unifi",
    login: vi.fn().mockResolvedValue(undefined),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    ensurePortForward: vi.fn().mockResolvedValue({ dnatId: "dnat-new", firewallId: "fw-new" }),
    updatePortForward: vi.fn().mockImplementation(async (handle) => handle),
    deletePortForward: vi.fn().mockResolvedValue(undefined),
    repairPortForward: vi.fn().mockImplementation(async (handle) => handle),
  };
}

describe("SyncWatchdog", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("re-creates ports missing from provider (not expired)", async () => {
    const mappingId = db.createMapping({
      provider: "azire",
      vpnPort: 58216,
      destIp: "192.168.1.100",
      destPort: 8080,
      protocol: "tcp",
      label: "test",
      status: "active",
      expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
    });
    db.updateMapping(mappingId, {
      routerHandle: { dnatId: "dnat-1", firewallId: "fw-1" },
    });

    const provider = mockProvider([]);
    const router = mockRouter();

    const watchdog = createSyncWatchdog({ db, provider, router, renewThresholdDays: 7 });
    await watchdog.runOnce();

    expect(provider.createPort).toHaveBeenCalled();
    const mapping = db.getMapping(mappingId)!;
    expect(mapping.status).toBe("active");
    expect(mapping.vpnPort).toBe(60000);
    expect(router.updatePortForward).toHaveBeenCalled();
    const [[, spec]] = (router.updatePortForward as ReturnType<typeof vi.fn>).mock.calls;
    expect(spec.vpnPort).toBe(60000);
  });

  it("marks truly expired ports (past expiresAt) as expired", async () => {
    const mappingId = db.createMapping({
      provider: "azire",
      vpnPort: 58216,
      destIp: "192.168.1.100",
      destPort: 8080,
      protocol: "tcp",
      label: "test",
      status: "active",
      expiresAt: Math.floor(Date.now() / 1000) - 86400,
    });
    db.updateMapping(mappingId, {
      routerHandle: { dnatId: "dnat-1", firewallId: "fw-1" },
    });

    const provider = mockProvider([]);
    const router = mockRouter();

    const watchdog = createSyncWatchdog({ db, provider, router, renewThresholdDays: 7 });
    await watchdog.runOnce();

    expect(provider.createPort).not.toHaveBeenCalled();
    const mapping = db.getMapping(mappingId)!;
    expect(mapping.status).toBe("expired");
    expect(router.deletePortForward).toHaveBeenCalledWith(
      expect.objectContaining({ dnatId: "dnat-1", firewallId: "fw-1" })
    );
  });

  it("sets status to error when port re-creation fails", async () => {
    const mappingId = db.createMapping({
      provider: "azire",
      vpnPort: 58216,
      destIp: "192.168.1.100",
      destPort: 8080,
      protocol: "tcp",
      label: "test",
      status: "active",
      expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
    });

    const provider = mockProvider([]);
    (provider.createPort as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Provider unreachable"));
    const router = mockRouter();

    const watchdog = createSyncWatchdog({ db, provider, router, renewThresholdDays: 7 });
    await watchdog.runOnce();

    const mapping = db.getMapping(mappingId)!;
    expect(mapping.status).toBe("error");
    expect(mapping.vpnPort).toBe(58216);
  });

  it("auto-renews ports expiring soon", async () => {
    const tenDaysFromNow = Math.floor(Date.now() / 1000) + 86400 * 10;
    const mappingId = db.createMapping({
      provider: "azire",
      vpnPort: 58216,
      destIp: "192.168.1.100",
      destPort: 8080,
      protocol: "tcp",
      label: "test",
      status: "active",
      expiresAt: tenDaysFromNow,
    });

    const provider = mockProvider([{ port: 58216, expiresAt: tenDaysFromNow }]);
    const router = mockRouter();

    const watchdog = createSyncWatchdog({ db, provider, router, renewThresholdDays: 30 });
    await watchdog.runOnce();

    expect(provider.deletePort).toHaveBeenCalledWith(58216);
    expect(provider.createPort).toHaveBeenCalled();

    const mapping = db.getMapping(mappingId)!;
    expect(mapping.vpnPort).toBe(60000);
    expect(mapping.expiresAt).toBe(9999999999);
  });

  it("repairs missing router rules via repairPortForward", async () => {
    const mappingId = db.createMapping({
      provider: "azire",
      vpnPort: 58216,
      destIp: "192.168.1.100",
      destPort: 8080,
      protocol: "tcp",
      label: "test",
      status: "active",
      expiresAt: Math.floor(Date.now() / 1000) + 86400 * 60,
    });
    db.updateMapping(mappingId, { routerHandle: { dnatId: "dnat-old", firewallId: "fw-old" } });

    const provider = mockProvider([
      { port: 58216, expiresAt: Math.floor(Date.now() / 1000) + 86400 * 60 },
    ]);
    const router = mockRouter();
    (router.repairPortForward as ReturnType<typeof vi.fn>).mockResolvedValue({
      dnatId: "dnat-fresh",
      firewallId: "fw-old",
    });

    const watchdog = createSyncWatchdog({ db, provider, router, renewThresholdDays: 7 });
    await watchdog.runOnce();

    expect(router.repairPortForward).toHaveBeenCalled();
    const mapping = db.getMapping(mappingId)!;
    expect(mapping.routerHandle).toEqual({ dnatId: "dnat-fresh", firewallId: "fw-old" });
  });
});
