import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { createDb } from "../../src/db.js";
import type { Db } from "../../src/db.js";
import type { VpnProvider } from "../../src/providers/types.js";
import type { RouterClient } from "../../src/routers/types.js";
import type { Runtime } from "../../src/runtime.js";
import { createApiRoutes } from "../../src/routes/api.js";
import { clearExternalIpCache } from "../../src/services/external-ip.js";

function fakeRuntime(provider: VpnProvider, router: RouterClient, maxPorts?: number): Runtime {
  return {
    getProvider: () => provider,
    getRouter: () => router,
    getMaxPorts: () => maxPorts ?? provider.maxPorts,
    isReady: () => true,
    reloadVpn: () => {},
    reloadRouter: () => {},
    reloadApp: () => {},
    stop: () => {},
  };
}

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

function mockRouter(): RouterClient {
  let dnatCounter = 0;
  let fwCounter = 0;
  return {
    name: "unifi",
    login: vi.fn().mockResolvedValue(undefined),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    ensurePortForward: vi.fn().mockImplementation(async () => ({
      dnatId: `dnat-${++dnatCounter}`,
      firewallId: `fw-${++fwCounter}`,
    })),
    updatePortForward: vi.fn().mockImplementation(async (handle) => handle),
    deletePortForward: vi.fn().mockResolvedValue(undefined),
    repairPortForward: vi.fn().mockImplementation(async (handle) => handle),
  };
}

describe("API routes", () => {
  let db: Db;
  let provider: VpnProvider;
  let router: RouterClient;
  let app: Hono;

  beforeEach(() => {
    portCounter = 60000;
    db = createDb(":memory:");
    provider = mockProvider();
    router = mockRouter();
    app = new Hono();
    app.route("/api", createApiRoutes({ db, runtime: fakeRuntime(provider, router) }));
    clearExternalIpCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ip: "203.0.113.1" }),
        } as unknown as Response)
      )
    );
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

  it("POST /api/mappings creates mapping via router.ensurePortForward", async () => {
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
    expect(mapping.routerHandle).toEqual({ dnatId: "dnat-1", firewallId: "fw-1" });
    expect(mapping.destIp).toBe("192.168.1.100");
    expect(mapping.destPort).toBe(8080);
    expect(mapping.label).toBe("test-service");

    expect(router.ensurePortForward).toHaveBeenCalledWith(
      expect.objectContaining({
        vpnPort: 60000,
        destIp: "192.168.1.100",
        destPort: 8080,
        label: "test-service",
        protocol: "tcp_udp",
      })
    );
  });

  it("DELETE /api/mappings/:id removes mapping and router rules", async () => {
    const createRes = await app.request("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destIp: "192.168.1.50", destPort: 9090, label: "to-delete" }),
    });
    const { mapping } = (await createRes.json()) as {
      mapping: { id: string; routerHandle: Record<string, unknown> };
    };

    const deleteRes = await app.request(`/api/mappings/${mapping.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);
    expect((await deleteRes.json()) as { success: boolean }).toEqual({ success: true });

    expect(router.deletePortForward).toHaveBeenCalledWith(
      expect.objectContaining({ dnatId: "dnat-1", firewallId: "fw-1" })
    );
    expect(db.getMapping(mapping.id)).toBeNull();
  });

  it("GET /api/status returns health info", async () => {
    (provider.listPorts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { port: 60001, expiresAt: 9999999999 },
    ]);

    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      provider: { connected: boolean; name: string; activePorts: number; maxPorts: number };
      router: { connected: boolean; name: string };
      externalIp: string | null;
      mappings: { total: number; active: number };
    };

    expect(body.provider.connected).toBe(true);
    expect(body.provider.name).toBe("azire");
    expect(body.provider.activePorts).toBe(1);
    expect(body.provider.maxPorts).toBe(5);
    expect(body.router.connected).toBe(true);
    expect(body.router.name).toBe("unifi");
    expect(body.externalIp).toBe("203.0.113.1");
    expect(body.mappings.total).toBe(0);
  });

  it("POST /api/mappings rejects when max ports reached", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destIp: `192.168.1.${i + 1}`, destPort: 8080 + i }),
      });
      expect(res.status).toBe(201);
    }

    const res = await app.request("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destIp: "192.168.1.99", destPort: 9999 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Cannot exceed maximum of 5 ports");
  });

  it("GET /api/logs returns sync log entries", async () => {
    await app.request("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destIp: "192.168.1.10", destPort: 8080, label: "logged" }),
    });

    const res = await app.request("/api/logs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { logs: { action: string }[] };
    expect(body.logs.length).toBeGreaterThan(0);
    expect(body.logs[0].action).toBe("create");
  });

  it("GET /api/ports/dangling returns provider ports not tracked in db", async () => {
    (provider.listPorts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { port: 60000, expiresAt: 9999999999 },
      { port: 60001, expiresAt: 9999999999 },
    ]);
    await app.request("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destIp: "192.168.1.10", destPort: 8080, label: "tracked" }),
    });

    const res = await app.request("/api/ports/dangling");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ports: { port: number }[] };
    expect(body.ports.map((p) => p.port)).toEqual([60001]);
  });

  it("POST /api/ports/dangling/:port/release deletes the port via provider", async () => {
    (provider.listPorts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { port: 60000, expiresAt: 9999999999 },
    ]);

    const res = await app.request("/api/ports/dangling/60000/release", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(provider.deletePort).toHaveBeenCalledWith(60000);
  });

  it("POST /api/ports/dangling/:port/release refuses when port is tracked", async () => {
    (provider.listPorts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { port: 60000, expiresAt: 9999999999 },
    ]);
    await app.request("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destIp: "192.168.1.10", destPort: 8080, label: "tracked" }),
    });

    const res = await app.request("/api/ports/dangling/60000/release", { method: "POST" });
    expect(res.status).toBe(404);
    expect(provider.deletePort).not.toHaveBeenCalled();
  });
});
