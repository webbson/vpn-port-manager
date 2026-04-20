import { Hono } from "hono";
import {
  appSettingsSchema,
  routerSettingsSchema,
  vpnSettingsSchema,
  type SettingsService,
  type VpnSettings,
} from "../settings.js";
import { createProvider } from "../providers/index.js";
import { createRouter } from "../routers/index.js";
import type { RouterSettings } from "../routers/types.js";

export interface SettingsRoutesConfig {
  settings: SettingsService;
}

export function createSettingsRoutes(config: SettingsRoutesConfig): Hono {
  const { settings } = config;
  const app = new Hono();

  app.get("/vpn", (c) => {
    const vpn = settings.getVpn();
    if (!vpn) return c.json({ configured: false });
    return c.json({
      configured: true,
      provider: vpn.provider,
      internalIp: vpn.internalIp,
    });
  });

  app.put("/vpn", async (c) => {
    const parsed = vpnSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
    settings.setVpn(parsed.data);
    return c.json({ ok: true, restartRequired: true });
  });

  app.post("/vpn/test", async (c) => {
    const parsed = vpnSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ ok: false, error: "invalid body" }, 400);
    return c.json(await testVpn(parsed.data));
  });

  app.get("/router", (c) => {
    const r = settings.getRouter();
    if (!r) return c.json({ configured: false });
    return c.json({
      configured: true,
      type: r.type,
      host: r.host,
      username: r.username,
      inInterfaceId: r.inInterfaceId,
      sourceZoneId: r.sourceZoneId,
      destinationZoneId: r.destinationZoneId,
    });
  });

  app.put("/router", async (c) => {
    const parsed = routerSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
    settings.setRouter(parsed.data);
    return c.json({ ok: true, restartRequired: true });
  });

  app.post("/router/test", async (c) => {
    const parsed = routerSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ ok: false, error: "invalid body" }, 400);
    const router = createRouter(parsed.data as RouterSettings);
    return c.json(await router.testConnection());
  });

  app.get("/app", (c) => c.json(settings.getApp()));

  app.put("/app", async (c) => {
    const parsed = appSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
    settings.setApp(parsed.data);
    return c.json({ ok: true, restartRequired: true });
  });

  return app;
}

async function testVpn(vpn: VpnSettings): Promise<{ ok: boolean; error?: string }> {
  try {
    const provider = createProvider(vpn);
    await provider.listPorts();
    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
