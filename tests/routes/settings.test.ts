import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { createDb } from "../../src/db.js";
import type { Db } from "../../src/db.js";
import { createSettingsService } from "../../src/settings.js";
import { createSettingsRoutes } from "../../src/routes/settings.js";

const KEY = "sixteen-or-more-chars-key";

function buildApp(db: Db) {
  const settings = createSettingsService(db, KEY);
  const app = new Hono();
  app.route("/api/settings", createSettingsRoutes({ settings }));
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
      syncIntervalMs: 300000,
      renewThresholdDays: 30,
    });
  });

  it("PUT /api/settings/app round-trips", async () => {
    const { app } = buildApp(db);
    const put = await app.request("/api/settings/app", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxPorts: 3, syncIntervalMs: 60000, renewThresholdDays: 7 }),
    });
    expect(put.status).toBe(200);
    const get = await app.request("/api/settings/app");
    expect(await get.json()).toEqual({ maxPorts: 3, syncIntervalMs: 60000, renewThresholdDays: 7 });
  });
});
