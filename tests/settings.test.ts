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
      vpnInterface: "wg0",
    });
    const row = db.getSetting("router")!;
    expect(row.encrypted).toBe(true);
    expect(row.valueJson).not.toContain("correct horse");
    expect(svc.getRouter()!.password).toBe("correct horse battery staple");
  });

  it("app settings persist in plaintext", () => {
    const svc = createSettingsService(db, KEY);
    svc.setApp({ maxPorts: 3, syncIntervalMs: 60000, renewThresholdDays: 7 });
    const row = db.getSetting("app")!;
    expect(row.encrypted).toBe(false);
    expect(JSON.parse(row.valueJson)).toEqual({
      maxPorts: 3,
      syncIntervalMs: 60000,
      renewThresholdDays: 7,
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
      vpnInterface: "wg0",
    });
    expect(svc.isConfigured()).toBe(true);
  });

  it("throws a clear error when the key has changed", () => {
    const svc = createSettingsService(db, KEY);
    svc.setVpn({ provider: "azire", apiToken: "t", internalIp: "10.0.0.1" });
    const other = createSettingsService(db, "different-secret-key-0000000000");
    expect(() => other.getVpn()).toThrow(/APP_SECRET_KEY wrong or data corrupt/);
  });

  it("rejects invalid settings at the boundary", () => {
    const svc = createSettingsService(db, KEY);
    expect(() =>
      svc.setRouter({
        type: "unifi",
        host: "not-a-url",
        username: "u",
        password: "p",
        vpnInterface: "wg0",
      })
    ).toThrow();
  });
});
