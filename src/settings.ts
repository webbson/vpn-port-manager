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
  vpnInterface: z.string().min(1),
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

export interface SettingsService {
  getVpn(): VpnSettings | null;
  getRouter(): RouterSettings | null;
  getApp(): AppSettings;
  setVpn(v: VpnSettings): void;
  setRouter(r: RouterSettings): void;
  setApp(a: AppSettings): void;
  isConfigured(): boolean;
}

export function createSettingsService(db: Db, appSecretKey: string): SettingsService {
  function readEncrypted<T>(key: string, schema: z.ZodType<T>): T | null {
    const row = db.getSetting(key);
    if (!row) return null;
    const raw = row.encrypted ? decrypt(row.valueJson, appSecretKey) : row.valueJson;
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `Stored ${key} settings failed validation: ${JSON.stringify(parsed.error.issues)}`
      );
    }
    return parsed.data;
  }

  function writeEncrypted<T>(key: string, value: T): void {
    db.setSetting(key, encrypt(JSON.stringify(value), appSecretKey), true);
  }

  function writePlain<T>(key: string, value: T): void {
    db.setSetting(key, JSON.stringify(value), false);
  }

  return {
    getVpn: () => readEncrypted("vpn", vpnSettingsSchema),
    getRouter: () => readEncrypted("router", routerSettingsSchema),

    getApp(): AppSettings {
      const row = db.getSetting("app");
      if (!row) return { ...DEFAULT_APP_SETTINGS };
      const parsed = appSettingsSchema.safeParse(JSON.parse(row.valueJson));
      if (!parsed.success) return { ...DEFAULT_APP_SETTINGS };
      return parsed.data;
    },

    setVpn: (v) => writeEncrypted("vpn", vpnSettingsSchema.parse(v)),
    setRouter: (r) => writeEncrypted("router", routerSettingsSchema.parse(r)),
    setApp: (a) => writePlain("app", appSettingsSchema.parse(a)),

    isConfigured(): boolean {
      return db.getSetting("vpn") !== null && db.getSetting("router") !== null;
    },
  };
}
