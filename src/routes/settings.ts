import { Hono } from "hono";
import { z } from "zod";
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
import { discoverUnifi } from "../routers/unifi/discovery.js";

const routerCredsSchema = z.object({
  type: z.literal("unifi"),
  host: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
});

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

  // Populate dropdowns in the UI. Accepts a partial body — when password is
  // missing or blank, falls back to the stored one so the user doesn't have
  // to retype it every time.
  app.post("/router/discover", async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const stored = settings.getRouter();
    const merged = {
      type: (body.type as string | undefined) ?? stored?.type ?? "unifi",
      host: (body.host as string | undefined) ?? stored?.host ?? "",
      username: (body.username as string | undefined) ?? stored?.username ?? "",
      password:
        (body.password as string | undefined) && (body.password as string).length > 0
          ? (body.password as string)
          : stored?.password ?? "",
    };
    const parsed = routerCredsSchema.safeParse(merged);
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.issues }, 400);
    }
    try {
      const result = await discoverUnifi({
        host: parsed.data.host,
        username: parsed.data.username,
        password: parsed.data.password,
      });
      return c.json({ ok: true, ...result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: message });
    }
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
