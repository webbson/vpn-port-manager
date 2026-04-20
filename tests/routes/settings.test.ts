import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { createDb } from "../../src/db.js";
import type { Db } from "../../src/db.js";
import { createSettingsService } from "../../src/settings.js";
import { createSettingsRoutes } from "../../src/routes/settings.js";
import type { Runtime } from "../../src/runtime.js";

const KEY = "sixteen-or-more-chars-key";

function buildApp(db: Db) {
  const settings = createSettingsService(db, KEY);
  const app = new Hono();
  app.route("/api/settings", createSettingsRoutes({ settings }));
  return { app, settings };
}

function fakeRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    getProvider: () => { throw new Error("stub"); },
    getRouter: () => { throw new Error("stub"); },
    getMaxPorts: () => 0,
    getNotifier: () => ({ emit: () => {} }),
    isReady: () => true,
    reloadVpn: vi.fn(),
    reloadRouter: vi.fn(),
    reloadApp: vi.fn(),
    reloadNotifications: vi.fn(),
    stop: vi.fn(),
    ...overrides,
  };
}

function buildAppWithRuntime(db: Db, runtime: Runtime) {
  const settings = createSettingsService(db, KEY);
  const app = new Hono();
  app.route("/api/settings", createSettingsRoutes({ settings, runtime }));
  return { app, settings };
}

describe("settings API", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("GET /api/settings/vpn reports unconfigured when empty", async () => {
    const { app } = buildApp(db);
    const res = await app.request("/api/settings/vpn");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: false });
  });

  it("PUT then GET /api/settings/vpn never returns apiToken", async () => {
    const { app } = buildApp(db);
    const put = await app.request("/api/settings/vpn", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "azire", apiToken: "super-secret", internalIp: "10.0.0.1" }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true, restartRequired: true });

    const get = await app.request("/api/settings/vpn");
    const body = (await get.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      configured: true,
      provider: "azire",
      internalIp: "10.0.0.1",
    });
    expect(body).not.toHaveProperty("apiToken");
  });

  it("PUT then GET /api/settings/router never returns password", async () => {
    const { app } = buildApp(db);
    const put = await app.request("/api/settings/router", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "unifi",
        host: "https://1.2.3.4",
        username: "admin",
        password: "correct horse battery staple",
        inInterfaceId: "iface-1",
        sourceZoneId: "zone-src",
        destinationZoneId: "zone-dst",
      }),
    });
    expect(put.status).toBe(200);

    const get = await app.request("/api/settings/router");
    const body = (await get.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      configured: true,
      type: "unifi",
      host: "https://1.2.3.4",
      username: "admin",
      inInterfaceId: "iface-1",
      sourceZoneId: "zone-src",
      destinationZoneId: "zone-dst",
    });
    expect(body).not.toHaveProperty("password");
  });

  it("rejects invalid bodies on PUT", async () => {
    const { app } = buildApp(db);
    const res = await app.request("/api/settings/router", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "unifi", host: "not-a-url", username: "u", password: "p", vpnInterface: "wg0" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/settings/app returns defaults", async () => {
    const { app } = buildApp(db);
    const res = await app.request("/api/settings/app");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      maxPorts: null,
      syncIntervalMinutes: 15,
      renewThresholdDays: 30,
    });
  });

  it("PUT /api/settings/app round-trips", async () => {
    const { app } = buildApp(db);
    const put = await app.request("/api/settings/app", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxPorts: 3, syncIntervalMinutes: 2, renewThresholdDays: 7 }),
    });
    expect(put.status).toBe(200);
    const get = await app.request("/api/settings/app");
    expect(await get.json()).toEqual({ maxPorts: 3, syncIntervalMinutes: 2, renewThresholdDays: 7 });
  });

  it("PUT /api/settings/vpn with runtime triggers reloadVpn and returns restartRequired: false", async () => {
    const runtime = fakeRuntime();
    const { app } = buildAppWithRuntime(db, runtime);
    const res = await app.request("/api/settings/vpn", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "azire", apiToken: "tok", internalIp: "10.0.0.1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, restartRequired: false });
    expect(runtime.reloadVpn).toHaveBeenCalled();
  });

  it("PUT /api/settings/router falls back to restartRequired: true with error when reload throws", async () => {
    const runtime = fakeRuntime({
      reloadRouter: vi.fn(() => { throw new Error("boom"); }),
    });
    const { app } = buildAppWithRuntime(db, runtime);
    const res = await app.request("/api/settings/router", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "unifi",
        host: "https://1.2.3.4",
        username: "admin",
        password: "p",
        inInterfaceId: "i",
        sourceZoneId: "s",
        destinationZoneId: "d",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { restartRequired: boolean; reloadError: string };
    expect(body.restartRequired).toBe(true);
    expect(body.reloadError).toBe("boom");
  });

  it("PUT /api/settings/app with runtime triggers reloadApp", async () => {
    const runtime = fakeRuntime();
    const { app } = buildAppWithRuntime(db, runtime);
    const res = await app.request("/api/settings/app", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxPorts: 2, syncIntervalMinutes: 1, renewThresholdDays: 7 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, restartRequired: false });
    expect(runtime.reloadApp).toHaveBeenCalled();
  });
});
