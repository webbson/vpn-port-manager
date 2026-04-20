import { z } from "zod";
import { encrypt, decrypt } from "./crypto.js";
import type { Db } from "./db.js";
import type { RouterSettings } from "./routers/types.js";

export const vpnSettingsSchema = z.object({
  provider: z.literal("azire"),
  apiToken: z.string().min(1),
  internalIp: z.string().min(1),
});
export type VpnSettings = z.infer<typeof vpnSettingsSchema>;

export const routerSettingsSchema = z.object({
  type: z.literal("unifi"),
  host: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  inInterfaceId: z.string().min(1),
  sourceZoneId: z.string().min(1),
  destinationZoneId: z.string().min(1),
});

export const appSettingsSchema = z.object({
  maxPorts: z.number().int().positive().nullable(),
  syncIntervalMs: z.number().int().positive(),
  renewThresholdDays: z.number().int().positive(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  maxPorts: null,
  syncIntervalMs: 300000,
  renewThresholdDays: 30,
};

export type SettingStatus = "ok" | "missing" | "invalid";

export interface SettingsIssues {
  vpn: SettingStatus;
  router: SettingStatus;
  messages: string[];
}

export interface SettingsService {
  getVpn(): VpnSettings | null;
  getRouter(): RouterSettings | null;
  getApp(): AppSettings;
  setVpn(v: VpnSettings): void;
  setRouter(r: RouterSettings): void;
  setApp(a: AppSettings): void;
  isConfigured(): boolean;
  getIssues(): SettingsIssues;
}

export function createSettingsService(db: Db, appSecretKey: string): SettingsService {
  // Reads a row and decrypts if necessary. Hard-fails on decrypt errors (wrong
  // APP_SECRET_KEY) so we never silently overwrite valid encrypted data with
  // fresh blank values. Returns null if the row is missing OR if its shape no
  // longer matches the current schema — that scenario shows up in the UI as
  // "needs re-save".
  function readAndValidate<T>(
    key: string,
    schema: z.ZodType<T>
  ): { value: T | null; status: SettingStatus; error?: string } {
    const row = db.getSetting(key);
    if (!row) return { value: null, status: "missing" };
    const raw = row.encrypted ? decrypt(row.valueJson, appSecretKey) : row.valueJson;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[settings] ${key} row is not valid JSON: ${msg}`);
      return { value: null, status: "invalid", error: msg };
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      console.warn(`[settings] ${key} row fails current schema — needs re-save: ${msg}`);
      return { value: null, status: "invalid", error: msg };
    }
    return { value: parsed.data, status: "ok" };
  }

  function writeEncrypted<T>(key: string, value: T): void {
    db.setSetting(key, encrypt(JSON.stringify(value), appSecretKey), true);
  }

  function writePlain<T>(key: string, value: T): void {
    db.setSetting(key, JSON.stringify(value), false);
  }

  function vpnRead() {
    return readAndValidate("vpn", vpnSettingsSchema);
  }
  function routerRead() {
    return readAndValidate("router", routerSettingsSchema);
  }

  return {
    getVpn: () => vpnRead().value,
    getRouter: () => routerRead().value,

    getApp(): AppSettings {
      const row = db.getSetting("app");
      if (!row) return { ...DEFAULT_APP_SETTINGS };
      try {
        const parsed = appSettingsSchema.safeParse(JSON.parse(row.valueJson));
        if (!parsed.success) return { ...DEFAULT_APP_SETTINGS };
        return parsed.data;
      } catch {
        return { ...DEFAULT_APP_SETTINGS };
      }
    },

    setVpn: (v) => writeEncrypted("vpn", vpnSettingsSchema.parse(v)),
    setRouter: (r) => writeEncrypted("router", routerSettingsSchema.parse(r)),
    setApp: (a) => writePlain("app", appSettingsSchema.parse(a)),

    isConfigured(): boolean {
      return vpnRead().status === "ok" && routerRead().status === "ok";
    },

    getIssues(): SettingsIssues {
      const vpn = vpnRead();
      const router = routerRead();
      const messages: string[] = [];
      if (vpn.status === "invalid") messages.push(`VPN settings need re-save: ${vpn.error ?? "stale schema"}`);
      if (router.status === "invalid") messages.push(`Router settings need re-save: ${router.error ?? "stale schema"}`);
      return { vpn: vpn.status, router: router.status, messages };
    },
  };
}
