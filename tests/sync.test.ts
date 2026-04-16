import { describe, it, expect, beforeEach, vi } from "vitest";
import { createDb } from "../src/db.js";
import type { Db } from "../src/db.js";
import type { VpnProvider } from "../src/providers/types.js";
import type { UnifiClient } from "../src/unifi/types.js";
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

function mockUnifi(): UnifiClient {
  return {
    login: vi.fn().mockResolvedValue(undefined),
    createDnatRule: vi.fn().mockResolvedValue("dnat-new"),
    updateDnatRule: vi.fn().mockResolvedValue(undefined),
    deleteDnatRule: vi.fn().mockResolvedValue(undefined),
    getDnatRule: vi.fn().mockResolvedValue({ _id: "dnat-1" }),
    createFirewallRule: vi.fn().mockResolvedValue("fw-new"),
    updateFirewallRule: vi.fn().mockResolvedValue(undefined),
    deleteFirewallRule: vi.fn().mockResolvedValue(undefined),
    getFirewallRule: vi.fn().mockResolvedValue({ _id: "fw-1" }),
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
      expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days out — not expired
    });
    db.updateMapping(mappingId, {
      unifiDnatId: "dnat-1",
      unifiFirewallId: "fw-1",
    });

    // Provider returns empty list — port 58216 is gone (e.g., provider restart)
    const provider = mockProvider([]);
    const unifi = mockUnifi();

    const watchdog = createSyncWatchdog({ db, provider, unifi, renewThresholdDays: 7 });
    await watchdog.runOnce();

    // Should re-create port, NOT mark as expired
    expect(provider.createPort).toHaveBeenCalled();
    const mapping = db.getMapping(mappingId)!;
    expect(mapping.status).toBe("active");
    expect(mapping.vpnPort).toBe(60000); // new port from mock
    // UniFi rules updated in place with new port
    expect(unifi.updateDnatRule).toHaveBeenCalledWith("dnat-1", { dst_port: "60000" });
    expect(unifi.updateFirewallRule).toHaveBeenCalledWith("fw-1", { dst_port: "60000" });
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
      expiresAt: Math.floor(Date.now() / 1000) - 86400, // expired yesterday
    });
    db.updateMapping(mappingId, {
      unifiDnatId: "dnat-1",
      unifiFirewallId: "fw-1",
    });

    // Provider returns empty list — port is gone AND expired
    const provider = mockProvider([]);
    const unifi = mockUnifi();

    const watchdog = createSyncWatchdog({ db, provider, unifi, renewThresholdDays: 7 });
    await watchdog.runOnce();

    // Should mark expired and delete UniFi rules, NOT re-create
    expect(provider.createPort).not.toHaveBeenCalled();
    const mapping = db.getMapping(mappingId)!;
    expect(mapping.status).toBe("expired");
    expect(unifi.deleteDnatRule).toHaveBeenCalledWith("dnat-1");
    expect(unifi.deleteFirewallRule).toHaveBeenCalledWith("fw-1");
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
    // createPort fails (provider is down)
    (provider.createPort as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Provider unreachable"));
    const unifi = mockUnifi();

    const watchdog = createSyncWatchdog({ db, provider, unifi, renewThresholdDays: 7 });
    await watchdog.runOnce();

    const mapping = db.getMapping(mappingId)!;
    expect(mapping.status).toBe("error");
    // Port number unchanged since re-creation failed
    expect(mapping.vpnPort).toBe(58216);
  });

  it("auto-renews ports expiring soon", async () => {
    // expiresAt is 10 days from now, renewThresholdDays=30 → should renew
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

    // Provider returns the existing port so it's not marked expired
    const provider = mockProvider([{ port: 58216, expiresAt: tenDaysFromNow }]);
    const unifi = mockUnifi();

    const watchdog = createSyncWatchdog({ db, provider, unifi, renewThresholdDays: 30 });
    await watchdog.runOnce();

    expect(provider.deletePort).toHaveBeenCalledWith(58216);
    expect(provider.createPort).toHaveBeenCalled();

    const mapping = db.getMapping(mappingId)!;
    expect(mapping.vpnPort).toBe(60000);
    expect(mapping.expiresAt).toBe(9999999999);
  });

  it("re-creates missing UniFi DNAT rules", async () => {
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
    db.updateMapping(mappingId, { unifiDnatId: "dnat-old" });

    // Provider has the port — no expiry
    const provider = mockProvider([
      { port: 58216, expiresAt: Math.floor(Date.now() / 1000) + 86400 * 60 },
    ]);
    const unifi = mockUnifi();
    // getDnatRule returns null → rule is missing
    (unifi.getDnatRule as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const watchdog = createSyncWatchdog({ db, provider, unifi, renewThresholdDays: 7 });
    await watchdog.runOnce();

    expect(unifi.createDnatRule).toHaveBeenCalled();

    const mapping = db.getMapping(mappingId)!;
    expect(mapping.unifiDnatId).toBe("dnat-new");
  });
});
