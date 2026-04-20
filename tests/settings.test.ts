import { describe, it, expect, beforeEach } from "vitest";
import { createDb } from "../src/db.js";
import type { Db } from "../src/db.js";
import {
  createSettingsService,
  DEFAULT_APP_SETTINGS,
} from "../src/settings.js";

const KEY = "test-secret-key-0123456789abcdef";

describe("SettingsService", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("returns null for unset vpn/router and defaults for app", () => {
    const svc = createSettingsService(db, KEY);
    expect(svc.getVpn()).toBeNull();
    expect(svc.getRouter()).toBeNull();
    expect(svc.getApp()).toEqual(DEFAULT_APP_SETTINGS);
    expect(svc.isConfigured()).toBe(false);
  });

  it("round-trips vpn settings (encrypted on disk)", () => {
    const svc = createSettingsService(db, KEY);
    svc.setVpn({ provider: "azire", apiToken: "super-secret", internalIp: "10.0.16.1" });
    expect(svc.getVpn()).toEqual({
      provider: "azire",
      apiToken: "super-secret",
      internalIp: "10.0.16.1",
    });
    const row = db.getSetting("vpn")!;
    expect(row.encrypted).toBe(true);
    expect(row.valueJson.startsWith("v1:")).toBe(true);
    expect(row.valueJson).not.toContain("super-secret");
  });

  it("round-trips router settings (encrypted on disk)", () => {
    const svc = createSettingsService(db, KEY);
    svc.setRouter({
      type: "unifi",
      host: "https://192.168.1.1",
      username: "admin",
      password: "correct horse battery staple",
      inInterfaceId: "iface-1",
      sourceZoneId: "zone-src",
      destinationZoneId: "zone-dst",
    });
    const row = db.getSetting("router")!;
    expect(row.encrypted).toBe(true);
    expect(row.valueJson).not.toContain("correct horse");
    expect(svc.getRouter()!.password).toBe("correct horse battery staple");
  });

  it("app settings persist in plaintext", () => {
    const svc = createSettingsService(db, KEY);
    svc.setApp({ maxPorts: 3, syncIntervalMinutes: 1, renewThresholdDays: 7 });
    const row = db.getSetting("app")!;
    expect(row.encrypted).toBe(false);
    expect(JSON.parse(row.valueJson)).toEqual({
      maxPorts: 3,
      syncIntervalMinutes: 1,
      renewThresholdDays: 7,
    });
  });

  it("getApp() migrates legacy syncIntervalMs rows to syncIntervalMinutes", () => {
    // Simulate a pre-migration app-settings row written by an older build.
    db.setSetting(
      "app",
      JSON.stringify({ maxPorts: null, syncIntervalMs: 300000, renewThresholdDays: 30 }),
      false,
    );
    const svc = createSettingsService(db, KEY);
    expect(svc.getApp()).toEqual({
      maxPorts: null,
      syncIntervalMinutes: 5,
      renewThresholdDays: 30,
    });
  });

  it("isConfigured true only when both vpn and router are set", () => {
    const svc = createSettingsService(db, KEY);
    expect(svc.isConfigured()).toBe(false);
    svc.setVpn({ provider: "azire", apiToken: "t", internalIp: "10.0.0.1" });
    expect(svc.isConfigured()).toBe(false);
    svc.setRouter({
      type: "unifi",
      host: "https://1.2.3.4",
      username: "u",
      password: "p",
      inInterfaceId: "iface-1",
      sourceZoneId: "zone-src",
      destinationZoneId: "zone-dst",
    });
    expect(svc.isConfigured()).toBe(true);
  });

  it("throws a clear error when the key has changed (so we never overwrite data)", () => {
    const svc = createSettingsService(db, KEY);
    svc.setVpn({ provider: "azire", apiToken: "t", internalIp: "10.0.0.1" });
    const other = createSettingsService(db, "different-secret-key-0000000000");
    expect(() => other.getVpn()).toThrow(/APP_SECRET_KEY wrong or data corrupt/);
  });

  it("treats a stale/incompatible router row as invalid without throwing", () => {
    // Simulate a router row from a previous version of the schema
    const svc = createSettingsService(db, KEY);
    // Write raw (encrypted) JSON with the old vpnInterface shape
    // using setVpn then manually poking setSetting for router
    svc.setVpn({ provider: "azire", apiToken: "tok", internalIp: "10.0.0.1" });
    db.setSetting(
      "router",
      // Plain JSON (encrypted=false) — settings service should still try schema
      JSON.stringify({ type: "unifi", host: "https://1.2.3.4", username: "u", password: "p", vpnInterface: "wg0" }),
      false
    );

    // Must not throw
    const issues = svc.getIssues();
    expect(issues.router).toBe("invalid");
    expect(issues.vpn).toBe("ok");
    expect(issues.messages.some((m) => /Router settings need re-save/.test(m))).toBe(true);

    // getRouter returns null rather than throwing
    expect(svc.getRouter()).toBeNull();

    // isConfigured reflects the stale state
    expect(svc.isConfigured()).toBe(false);
  });

  it("rejects invalid settings at the boundary", () => {
    const svc = createSettingsService(db, KEY);
    expect(() =>
      svc.setRouter({
        type: "unifi",
        host: "not-a-url",
        username: "u",
        password: "p",
        inInterfaceId: "iface-1",
      sourceZoneId: "zone-src",
      destinationZoneId: "zone-dst",
      })
    ).toThrow();
  });
});
