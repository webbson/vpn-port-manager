import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { createDb, type Db } from "../../src/db.js";
import type { VpnProvider } from "../../src/providers/types.js";
import type { RouterClient } from "../../src/routers/types.js";
import type { Runtime } from "../../src/runtime.js";
import { createUiRoutes } from "../../src/routes/ui.js";
import { clearExternalIpCache } from "../../src/services/external-ip.js";

function mockProvider(): VpnProvider {
  return {
    name: "azire",
    maxPorts: 5,
    listPorts: vi.fn().mockResolvedValue([]),
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
    ensurePortForward: vi.fn().mockResolvedValue({ dnatId: "d1", firewallId: "f1" }),
    updatePortForward: vi.fn().mockImplementation(async (handle) => handle),
    deletePortForward: vi.fn().mockResolvedValue(undefined),
    repairPortForward: vi.fn().mockImplementation(async (handle) => handle),
  };
}

function fakeRuntime(provider: VpnProvider, router: RouterClient): Runtime {
  return {
    getProvider: () => provider,
    getRouter: () => router,
    getMaxPorts: () => provider.maxPorts,
    isReady: () => true,
    reloadVpn: () => {},
    reloadRouter: () => {},
    reloadApp: () => {},
    stop: () => {},
  };
}

function urlEncode(body: Record<string, string>): string {
  return Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

describe("UI /create fires hooks immediately", () => {
  it("fires configured hooks right after creating a mapping, not just via sync retry", async () => {
    const db = createDb(":memory:");
    const provider = mockProvider();
    const router = mockRouter();
    const app = new Hono();
    app.route("/", createUiRoutes({ db, runtime: fakeRuntime(provider, router) }));
    clearExternalIpCache();

    const fetchSpy = vi.fn((url: string) => {
      if (String(url).startsWith("http://plex.lan:32400/")) {
        return Promise.resolve({ ok: true, status: 200, statusText: "OK",
          json: () => Promise.resolve({}) } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200, statusText: "OK",
        json: () => Promise.resolve({ ip: "203.0.113.1" }) } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const body = urlEncode({
      label: "Plex",
      destIp: "10.13.37.5",
      destPort: "32400",
      protocol: "tcp",
      "hooks[0][type]": "plex",
      "hooks[0][host]": "http://plex.lan:32400",
      "hooks[0][token]": "tok",
    });
    const res = await app.request("/create", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(302);

    const plexCall = fetchSpy.mock.calls.find((c) => String(c[0]).startsWith("http://plex.lan:32400/"));
    expect(plexCall, "plex fetch was not issued on create").toBeTruthy();
    expect(String(plexCall![0])).toContain("ManualPortMappingPort=60000");

    const mappings = db.listMappings();
    expect(mappings).toHaveLength(1);
    const hooks = db.listHooks(mappings[0].id);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].lastStatus).toBe("ok");
  });
});

describe("UI /edit/:id hook editing", () => {
  let db: Db;
  let provider: VpnProvider;
  let router: RouterClient;
  let app: Hono;
  let mappingId: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    provider = mockProvider();
    router = mockRouter();
    app = new Hono();
    app.route("/", createUiRoutes({ db, runtime: fakeRuntime(provider, router) }));
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

    mappingId = db.createMapping({
      provider: "azire",
      vpnPort: 60000,
      destIp: "10.0.0.10",
      destPort: 22,
      protocol: "tcp",
      label: "ssh",
      status: "active",
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
    });
    db.createHook({ mappingId, type: "plugin", config: JSON.stringify({ plugin: "plex", host: "http://plex.lan:32400", token: "old" }) });
  });

  it("GET renders existing plex hooks with display-level type=plex (not nested 'plugin')", async () => {
    const res = await app.request(`/edit/${mappingId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    // Stored row is { type: "plugin", config.plugin: "plex" } — surfaced
    // in the builder seeds as { type: "plex", config: {host,token} }.
    expect(html).toContain('"type":"plex"');
    expect(html).toContain('"host":"http://plex.lan:32400"');
    expect(html).toContain('"token":"old"');
    expect(html).not.toMatch(/"config":\{[^}]*"plugin":"plex"/);
  });

  it("POST replaces the hook set with whatever was submitted", async () => {
    const body = urlEncode({
      label: "ssh",
      destIp: "10.0.0.10",
      destPort: "22",
      protocol: "tcp",
      "hooks[0][type]": "webhook",
      "hooks[0][url]": "https://example.com/hook",
      "hooks[0][method]": "POST",
    });
    const res = await app.request(`/edit/${mappingId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(302);

    const hooks = db.listHooks(mappingId);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].type).toBe("webhook");
    expect(JSON.parse(hooks[0].config)).toEqual({
      url: "https://example.com/hook",
      method: "POST",
    });
  });

  it("POST with no hook fields removes all hooks", async () => {
    const body = urlEncode({
      label: "ssh",
      destIp: "10.0.0.10",
      destPort: "22",
      protocol: "tcp",
    });
    const res = await app.request(`/edit/${mappingId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(302);
    expect(db.listHooks(mappingId)).toEqual([]);
  });

  it("POST /hooks/:id/fire runs a single hook with the mapping's current port and records status", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve({}),
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchSpy);

    const [hook] = db.listHooks(mappingId);
    const res = await app.request(`/hooks/${hook.id}/fire`, { method: "POST" });
    expect(res.status).toBe(302);

    const plexCall = fetchSpy.mock.calls.find((c) => String(c[0]).startsWith("http://plex.lan:32400/"));
    expect(plexCall, "plex fetch was not issued").toBeTruthy();
    expect(String(plexCall![0])).toContain("ManualPortMappingPort=60000");
    expect(String(plexCall![0])).toContain("X-Plex-Token=old");

    const fresh = db.listHooks(mappingId)[0];
    expect(fresh.lastStatus).toBe("ok");
  });

  it("POST with display-level type=plex is stored as {type:'plugin', config.plugin:'plex'}", async () => {
    const body = urlEncode({
      label: "ssh",
      destIp: "10.0.0.10",
      destPort: "22",
      protocol: "tcp",
      "hooks[0][type]": "plex",
      "hooks[0][host]": "http://plex.lan:32400",
      "hooks[0][token]": "new-token",
    });
    const res = await app.request(`/edit/${mappingId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(302);

    const hooks = db.listHooks(mappingId);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].type).toBe("plugin");
    expect(JSON.parse(hooks[0].config)).toEqual({
      plugin: "plex",
      host: "http://plex.lan:32400",
      token: "new-token",
    });
  });

  it("POST with multiple hooks persists all of them", async () => {
    const body = urlEncode({
      label: "ssh",
      destIp: "10.0.0.10",
      destPort: "22",
      protocol: "tcp",
      "hooks[0][type]": "plugin",
      "hooks[0][plugin]": "plex",
      "hooks[0][host]": "http://plex.lan:32400",
      "hooks[0][token]": "new-token",
      "hooks[1][type]": "command",
      "hooks[1][command]": "/usr/local/bin/notify.sh {{label}} {{newPort}}",
    });
    const res = await app.request(`/edit/${mappingId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(res.status).toBe(302);

    const hooks = db.listHooks(mappingId);
    expect(hooks).toHaveLength(2);
    const byType = Object.fromEntries(hooks.map((h) => [h.type, JSON.parse(h.config)]));
    expect(byType.plugin).toEqual({ plugin: "plex", host: "http://plex.lan:32400", token: "new-token" });
    expect(byType.command).toEqual({ command: "/usr/local/bin/notify.sh {{label}} {{newPort}}" });
  });
});
