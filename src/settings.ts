import { z } from "zod";
import { encrypt, decrypt } from "./crypto.js";
import type { Db } from "./db.js";
import { vpnSettingsSchema } from "./providers/registry.js";
import { routerSettingsSchema } from "./routers/registry.js";
import {
  notificationsSettingsSchema,
  DEFAULT_NOTIFICATIONS_SETTINGS,
  type NotificationsSettings,
} from "./notifications/schema.js";

export { vpnSettingsSchema, routerSettingsSchema, notificationsSettingsSchema };
export type VpnSettings = z.infer<typeof vpnSettingsSchema>;
export type RouterSettings = z.infer<typeof routerSettingsSchema>;
export type { NotificationsSettings };

export const appSettingsSchema = z.object({
  maxPorts: z.number().int().positive().nullable(),
  syncIntervalMinutes: z.number().int().positive(),
  renewThresholdDays: z.number().int().positive(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  maxPorts: null,
  syncIntervalMinutes: 15,
  renewThresholdDays: 30,
};

// Upgrades a stored app-settings JSON blob from earlier versions where the
// sync interval was expressed in milliseconds (`syncIntervalMs`). If the new
// field is missing and the legacy field is present, convert and drop the old
// key. Returns the (possibly-unchanged) object.
function migrateAppSettingsJson(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  if (
    obj.syncIntervalMinutes === undefined &&
    typeof obj.syncIntervalMs === "number" &&
    obj.syncIntervalMs > 0
  ) {
    const { syncIntervalMs, ...rest } = obj;
    return { ...rest, syncIntervalMinutes: Math.max(1, Math.round((syncIntervalMs as number) / 60000)) };
  }
  return obj;
}

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
  getNotifications(): NotificationsSettings;
  setVpn(v: VpnSettings): void;
  setRouter(r: RouterSettings): void;
  setApp(a: AppSettings): void;
  setNotifications(n: NotificationsSettings): void;
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
        const migrated = migrateAppSettingsJson(JSON.parse(row.valueJson));
        const parsed = appSettingsSchema.safeParse(migrated);
        if (!parsed.success) return { ...DEFAULT_APP_SETTINGS };
        return parsed.data;
      } catch {
        return { ...DEFAULT_APP_SETTINGS };
      }
    },

    getNotifications(): NotificationsSettings {
      const row = db.getSetting("notifications");
      if (!row) return { ...DEFAULT_NOTIFICATIONS_SETTINGS };
      try {
        const raw = row.encrypted ? decrypt(row.valueJson, appSecretKey) : row.valueJson;
        const parsed = notificationsSettingsSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) return { ...DEFAULT_NOTIFICATIONS_SETTINGS };
        return parsed.data;
      } catch {
        return { ...DEFAULT_NOTIFICATIONS_SETTINGS };
      }
    },

    setVpn: (v) => writeEncrypted("vpn", vpnSettingsSchema.parse(v)),
    setRouter: (r) => writeEncrypted("router", routerSettingsSchema.parse(r)),
    setApp: (a) => writePlain("app", appSettingsSchema.parse(a)),
    setNotifications: (n) => writeEncrypted("notifications", notificationsSettingsSchema.parse(n)),

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
