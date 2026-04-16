import { z } from "zod";

const configSchema = z.object({
  vpnProvider: z.string().min(1),
  vpnApiToken: z.string().min(1),
  vpnInternalIp: z.string().min(1),
  maxPorts: z.number().int().positive().default(5),
  unifiHost: z.string().url(),
  unifiUsername: z.string().min(1),
  unifiPassword: z.string().min(1),
  unifiVpnInterface: z.string().min(1),
  syncIntervalMs: z.number().int().positive().default(300000),
  renewThresholdDays: z.number().int().positive().default(30),
  port: z.number().int().positive().default(3000),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    vpnProvider: process.env.VPN_PROVIDER,
    vpnApiToken: process.env.VPN_API_TOKEN,
    vpnInternalIp: process.env.VPN_INTERNAL_IP,
    maxPorts: process.env.MAX_PORTS ? Number(process.env.MAX_PORTS) : undefined,
    unifiHost: process.env.UNIFI_HOST,
    unifiUsername: process.env.UNIFI_USERNAME,
    unifiPassword: process.env.UNIFI_PASSWORD,
    unifiVpnInterface: process.env.UNIFI_VPN_INTERFACE,
    syncIntervalMs: process.env.SYNC_INTERVAL_MS
      ? Number(process.env.SYNC_INTERVAL_MS)
      : undefined,
    renewThresholdDays: process.env.RENEW_THRESHOLD_DAYS
      ? Number(process.env.RENEW_THRESHOLD_DAYS)
      : undefined,
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  });
}
