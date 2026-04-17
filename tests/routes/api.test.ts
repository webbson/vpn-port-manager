import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { createDb } from "../../src/db.js";
import type { Db } from "../../src/db.js";
import type { VpnProvider } from "../../src/providers/types.js";
import type { UnifiClient } from "../../src/unifi/types.js";
import { createApiRoutes } from "../../src/routes/api.js";

let portCounter = 60000;

function mockProvider(): VpnProvider {
  return {
    name: "azire",
    maxPorts: 5,
    listPorts: vi.fn().mockResolvedValue([]),
    createPort: vi.fn().mockImplementation(async () => {
      const port = portCounter++;
      return { port, expiresAt: 9999999999 };
    }),
    deletePort: vi.fn().mockResolvedValue(undefined),
    checkPort: vi.fn().mockResolvedValue(true),
  };
}

function mockUnifi(): UnifiClient {
  let dnatCounter = 0;
  let fwCounter = 0;
  return {
    login: vi.fn().mockResolvedValue(undefined),
    createDnatRule: vi.fn().mockImplementation(async () => `dnat-${++dnatCounter}`),
    updateDnatRule: vi.fn().mockResolvedValue(undefined),
    deleteDnatRule: vi.fn().mockResolvedValue(undefined),
    getDnatRule: vi.fn().mockResolvedValue({ _id: "dnat-1" }),
    createFirewallRule: vi.fn().mockImplementation(async () => `fw-${++fwCounter}`),
    updateFirewallRule: vi.fn().mockResolvedValue(undefined),
    deleteFirewallRule: vi.fn().mockResolvedValue(undefined),
    getFirewallRule: vi.fn().mockResolvedValue({ _id: "fw-1" }),
  };
}

describe("API routes", () => {
  let db: Db;
  let provider: VpnProvider;
  let unifi: UnifiClient;
  let app: Hono;

  beforeEach(() => {
    portCounter = 60000;
    db = createDb(":memory:");
    provider = mockProvider();
    unifi = mockUnifi();
    app = new Hono();
    app.route("/api", createApiRoutes({ db, provider, unifi, vpnInterface: "wg0" }));
  });

  it("GET /api/health returns ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("GET /api/mappings returns empty list", async () => {
    const res = await app.request("/api/mappings");
    expect(res.status).toBe(200);
    const body = await res.json() as { mappings: unknown[] };
    expect(body.mappings).toEqual([]);
  });

  it("POST /api/mappings creates mapping with UniFi rules", async () => {
    const res = await app.request("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destIp: "192.168.1.100",
        destPort: 8080,
        label: "test-service",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { mapping: Record<string, unknown> };
    const { mapping } = body;

    expect(mapping.vpnPort).toBe(60000);
    expect(mapping.status).toBe("active");
    expect(mapping.unifiDnatId).toBe("dnat-1");
    expect(mapping.unifiFirewallId).toBe("fw-1");
    expect(mapping.destIp).toBe("192.168.1.100");
    expect(mapping.destPort).toBe(8080);
    expect(mapping.label).toBe("test-service");

    expect(unifi.login).toHaveBeenCalled();
    expect(unifi.createDnatRule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "VPM: test-service",
        pfwd_interface: "wg0",
        dst_port: "60000",
        fwd: "192.168.1.100",
        fwd_port: "8080",
      })
    );
    expect(unifi.createFirewallRule).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "VPM: Allow test-service",
        ruleset: "WAN_IN",
        rule_index: 20000,
        action: "accept",
      })
    );
  });

  it("DELETE /api/mappings/:id removes mapping and UniFi rules", async () => {
    // Create first
    const createRes = await app.request("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destIp: "192.168.1.50", destPort: 9090, label: "to-delete" }),
    });
    const { mapping } = await createRes.json() as { mapping: { id: string; unifiDnatId: string; unifiFirewallId: string } };

    const deleteRes = await app.request(`/api/mappings/${mapping.id}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json() as { success: boolean };
    expect(deleteBody.success).toBe(true);

    // Verify UniFi rule deletion
    expect(unifi.deleteDnatRule).toHaveBeenCalledWith(mapping.unifiDnatId);
    expect(unifi.deleteFirewallRule).toHaveBeenCalledWith(mapping.unifiFirewallId);

    // Verify mapping gone from DB
    expect(db.getMapping(mapping.id)).toBeNull();
  });

  it("GET /api/status returns health info", async () => {
    (provider.listPorts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { port: 60001, expiresAt: 9999999999 },
    ]);

    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      provider: { connected: boolean; name: string; activePorts: number; maxPorts: number };
      unifi: { connected: boolean };
      mappings: { total: number; active: number };
    };

    expect(body.provider.connected).toBe(true);
    expect(body.provider.name).toBe("azire");
    expect(body.provider.activePorts).toBe(1);
    expect(body.provider.maxPorts).toBe(5);
    expect(body.unifi.connected).toBe(true);
    expect(body.mappings.total).toBe(0);
    expect(body.mappings.active).toBe(0);
  });

  it("POST /api/mappings rejects when max ports reached", async () => {
    // Create 5 mappings to fill the limit
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destIp: `192.168.1.${i + 1}`, destPort: 8080 + i }),
      });
      expect(res.status).toBe(201);
    }

    // 6th should fail
    const res = await app.request("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destIp: "192.168.1.99", destPort: 9999 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Cannot exceed maximum of 5 ports");
  });

  it("GET /api/logs returns sync log entries", async () => {
    // Create a mapping to produce a log entry
    await app.request("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destIp: "192.168.1.10", destPort: 8080, label: "logged" }),
    });

    const res = await app.request("/api/logs");
    expect(res.status).toBe(200);
    const body = await res.json() as { logs: { action: string }[] };
    expect(body.logs.length).toBeGreaterThan(0);
    expect(body.logs[0].action).toBe("create");
  });
});
