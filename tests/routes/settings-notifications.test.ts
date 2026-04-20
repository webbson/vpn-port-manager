import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { createDb } from "../../src/db.js";
import type { Db } from "../../src/db.js";
import { createSettingsService } from "../../src/settings.js";
import { createSettingsRoutes } from "../../src/routes/settings.js";
import type { Runtime } from "../../src/runtime.js";

const KEY = "sixteen-or-more-chars-key";

function buildApp(db: Db, runtime?: Runtime) {
  const settings = createSettingsService(db, KEY);
  const app = new Hono();
  app.route("/api/settings", createSettingsRoutes({ settings, runtime }));
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

const goodNtfy = {
  provider: "ntfy" as const,
  serverUrl: "https://ntfy.example.com",
  topic: "vpn-alerts",
  bearerToken: "super-secret-token",
};

describe("notifications settings API", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("GET /api/settings/notifications returns defaults when unconfigured", async () => {
    const { app } = buildApp(db);
    const res = await app.request("/api/settings/notifications");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: false,
      notifier: null,
      categories: {},
    });
  });

  it("PUT round-trip hides bearerToken via describeStored", async () => {
    const { app } = buildApp(db);
    const put = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        notifier: goodNtfy,
        categories: { "port.renewed": true, "port.expired": false },
      }),
    });
    expect(put.status).toBe(200);

    const get = await app.request("/api/settings/notifications");
    const body = (await get.json()) as Record<string, unknown>;
    expect(body.enabled).toBe(true);
    expect(body.categories).toMatchObject({ "port.renewed": true, "port.expired": false });
    const notifier = body.notifier as Record<string, unknown>;
    expect(notifier.provider).toBe("ntfy");
    expect(notifier.serverUrl).toBe("https://ntfy.example.com");
    expect(notifier.topic).toBe("vpn-alerts");
    expect(notifier.hasBearerToken).toBe(true);
    expect(notifier).not.toHaveProperty("bearerToken");
  });

  it("rejects invalid ntfy URL", async () => {
    const { app } = buildApp(db);
    const res = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        notifier: { ...goodNtfy, serverUrl: "not-a-url" },
        categories: {},
      }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT with runtime triggers reloadNotifications and returns restartRequired: false", async () => {
    const runtime = fakeRuntime();
    const { app } = buildApp(db, runtime);
    const res = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, notifier: goodNtfy, categories: {} }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, restartRequired: false });
    expect(runtime.reloadNotifications).toHaveBeenCalled();
  });

  it("falls back to restartRequired: true with reloadError when reloadNotifications throws", async () => {
    const runtime = fakeRuntime({
      reloadNotifications: vi.fn(() => { throw new Error("boom"); }),
    });
    const { app } = buildApp(db, runtime);
    const res = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, notifier: goodNtfy, categories: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { restartRequired: boolean; reloadError: string };
    expect(body.restartRequired).toBe(true);
    expect(body.reloadError).toBe("boom");
  });

  it("PUT preserves the stored bearer token when the body omits it", async () => {
    const { app } = buildApp(db);
    // First save with a token
    const first = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, notifier: goodNtfy, categories: {} }),
    });
    expect(first.status).toBe(200);

    // Second save without bearerToken — priority changed
    const second = await app.request("/api/settings/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        notifier: {
          provider: "ntfy",
          serverUrl: goodNtfy.serverUrl,
          topic: goodNtfy.topic,
          priority: 4,
        },
        categories: {},
      }),
    });
    expect(second.status).toBe(200);

    // Round-trip via describeStored should still report hasBearerToken: true
    const get = await app.request("/api/settings/notifications");
    const body = (await get.json()) as { notifier: Record<string, unknown> };
    expect(body.notifier.hasBearerToken).toBe(true);
    expect(body.notifier.priority).toBe(4);
  });

  it("POST /notifications/test calls the notifier backend with the supplied config", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(""),
    } as unknown as Response);
    vi.stubGlobal("fetch", mockFetch);

    const { app } = buildApp(db);
    const res = await app.request("/api/settings/notifications/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notifier: goodNtfy }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ntfy.example.com/vpn-alerts");
  });

  it("POST /notifications/test returns error on 4xx", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: () => Promise.resolve("bad token"),
    } as unknown as Response);
    vi.stubGlobal("fetch", mockFetch);

    const { app } = buildApp(db);
    const res = await app.request("/api/settings/notifications/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notifier: goodNtfy }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/401/);
  });
});
