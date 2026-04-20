import { Hono } from "hono";
import {
  appSettingsSchema,
  routerSettingsSchema,
  vpnSettingsSchema,
  type SettingsService,
  type VpnSettings,
} from "../settings.js";
import type { RouterSettings } from "../settings.js";
import { createProvider } from "../providers/index.js";
import { createRouter } from "../routers/index.js";
import { getProviderDefinition } from "../providers/registry.js";
import { getRouterDefinition } from "../routers/registry.js";
import type { Runtime } from "../runtime.js";

export interface SettingsRoutesConfig {
  settings: SettingsService;
  runtime?: Runtime;
}

function tryReload(fn: () => void): { ok: true } | { ok: false; error: string } {
  try {
    fn();
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export function createSettingsRoutes(config: SettingsRoutesConfig): Hono {
  const { settings, runtime } = config;
  const app = new Hono();

  app.get("/vpn", (c) => {
    const vpn = settings.getVpn();
    if (!vpn) return c.json({ configured: false });
    const def = getProviderDefinition(vpn.provider);
    if (!def) return c.json({ configured: false });
    return c.json({ configured: true, ...def.describeStored(vpn) });
  });

  app.put("/vpn", async (c) => {
    const parsed = vpnSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
    settings.setVpn(parsed.data);
    if (!runtime) return c.json({ ok: true, restartRequired: true });
    const reload = tryReload(() => runtime.reloadVpn());
    if (!reload.ok) {
      return c.json({ ok: true, restartRequired: true, reloadError: reload.error });
    }
    return c.json({ ok: true, restartRequired: false });
  });

  app.post("/vpn/test", async (c) => {
    const parsed = vpnSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ ok: false, error: "invalid body" }, 400);
    return c.json(await testVpn(parsed.data));
  });

  app.get("/router", (c) => {
    const r = settings.getRouter();
    if (!r) return c.json({ configured: false });
    const def = getRouterDefinition(r.type);
    if (!def) return c.json({ configured: false });
    return c.json({ configured: true, ...def.describeStored(r) });
  });

  app.put("/router", async (c) => {
    const parsed = routerSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
    settings.setRouter(parsed.data);
    if (!runtime) return c.json({ ok: true, restartRequired: true });
    const reload = tryReload(() => runtime.reloadRouter());
    if (!reload.ok) {
      return c.json({ ok: true, restartRequired: true, reloadError: reload.error });
    }
    return c.json({ ok: true, restartRequired: false });
  });

  app.post("/router/test", async (c) => {
    const parsed = routerSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ ok: false, error: "invalid body" }, 400);
    const router = createRouter(parsed.data as RouterSettings);
    return c.json(await router.testConnection());
  });

  // Dispatch discovery to the selected router's definition. Falls back to the
  // stored password when the request body omits it, so the user doesn't have
  // to retype it every time.
  app.post("/router/discover", async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const typeId = (body.type as string | undefined) ?? settings.getRouter()?.type;
    if (!typeId) return c.json({ ok: false, error: "router type missing" }, 400);
    const def = getRouterDefinition(typeId);
    if (!def) return c.json({ ok: false, error: `unknown router type: ${typeId}` }, 400);
    if (!def.discover) {
      return c.json({ ok: false, error: `${typeId} does not support discovery` }, 400);
    }
    const stored = settings.getRouter();
    const merged: Record<string, unknown> = { ...(stored ?? {}), ...body };
    if (!merged.password && stored && (stored as Record<string, unknown>).password) {
      merged.password = (stored as Record<string, unknown>).password;
    }
    const result = await def.discover(merged);
    return c.json(result);
  });

  app.get("/app", (c) => c.json(settings.getApp()));

  app.put("/app", async (c) => {
    const parsed = appSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues }, 400);
    settings.setApp(parsed.data);
    if (!runtime) return c.json({ ok: true, restartRequired: true });
    const reload = tryReload(() => runtime.reloadApp());
    if (!reload.ok) {
      return c.json({ ok: true, restartRequired: true, reloadError: reload.error });
    }
    return c.json({ ok: true, restartRequired: false });
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
