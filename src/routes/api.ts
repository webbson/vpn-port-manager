import { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../db.js";
import type { VpnProvider } from "../providers/types.js";
import type { UnifiClient } from "../unifi/types.js";
import { createHookRunner } from "../hooks/runner.js";
import type { HookPayload } from "../hooks/types.js";

export interface ApiRoutesConfig {
  db: Db;
  provider: VpnProvider;
  unifi: UnifiClient;
  vpnInterface: string;
  maxPorts?: number;
}

const createMappingSchema = z.object({
  destIp: z.string().min(1),
  destPort: z.number().int().positive(),
  protocol: z.string().optional(),
  label: z.string().optional(),
  hooks: z
    .array(
      z.object({
        type: z.string(),
        config: z.record(z.string(), z.unknown()),
      })
    )
    .optional(),
});

const updateMappingSchema = z.object({
  destIp: z.string().min(1).optional(),
  destPort: z.number().int().positive().optional(),
  protocol: z.string().optional(),
  label: z.string().optional(),
  hooks: z
    .array(
      z.object({
        type: z.string(),
        config: z.record(z.string(), z.unknown()),
      })
    )
    .optional(),
});

export function createApiRoutes(config: ApiRoutesConfig): Hono {
  const { db, provider, unifi, vpnInterface } = config;
  const maxPorts = config.maxPorts ?? provider.maxPorts;
  const hookRunner = createHookRunner();
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  async function fireHooks(mappingId: string, payload: HookPayload): Promise<void> {
    const hooks = db.listHooks(mappingId);
    for (const hook of hooks) {
      const result = await hookRunner.execute({ type: hook.type, config: hook.config }, payload);
      db.updateHookStatus(hook.id, result.success ? "success" : "error", result.error);
      if (!result.success) {
        console.error(`Hook ${hook.id} failed: ${result.error}`);
      }
    }
  }

  // GET /mappings
  app.get("/mappings", async (c) => {
    const mappings = db.listMappings();
    const withHooks = mappings.map((m) => ({
      ...m,
      hooks: db.listHooks(m.id),
    }));
    return c.json({ mappings: withHooks });
  });

  // POST /mappings
  app.post("/mappings", async (c) => {
    const parsed = createMappingSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues }, 400);
    }
    const body = parsed.data;

    // Check max ports
    const activeMappings = db.listMappings().filter((m) => m.status !== "expired" && m.status !== "error");
    if (activeMappings.length >= maxPorts) {
      return c.json({ error: `Cannot exceed maximum of ${maxPorts} ports` }, 400);
    }

    // Allocate port from provider
    const providerPort = await provider.createPort({ expiresInDays: 365 });

    // Resolve fields
    const label = body.label ?? `port-${providerPort.port}`;
    const protocol = body.protocol ?? "both";

    // Create mapping with status "pending"
    const mappingId = db.createMapping({
      provider: provider.name,
      vpnPort: providerPort.port,
      destIp: body.destIp,
      destPort: body.destPort,
      protocol,
      label,
      status: "pending",
      expiresAt: providerPort.expiresAt,
    });

    // Create UniFi rules
    let unifiDnatId: string | null = null;
    let unifiFirewallId: string | null = null;

    try {
      await unifi.login();

      const proto = protocol === "both" || protocol === undefined ? "tcp_udp" : protocol;

      unifiDnatId = await unifi.createDnatRule({
        name: `VPM: ${label}`,
        enabled: true,
        pfwd_interface: vpnInterface,
        src: "any",
        dst_port: String(providerPort.port),
        fwd: body.destIp,
        fwd_port: String(body.destPort),
        proto,
        log: false,
      });

      unifiFirewallId = await unifi.createFirewallRule({
        name: `VPM: Allow ${label}`,
        enabled: true,
        ruleset: "WAN_IN",
        rule_index: 20000,
        action: "accept",
        protocol: proto,
        src_firewallgroup_ids: [],
        dst_address: body.destIp,
        dst_port: String(body.destPort),
        logging: false,
      });

      db.updateMapping(mappingId, {
        status: "active",
        unifiDnatId,
        unifiFirewallId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`UniFi error creating rules for mapping ${mappingId}: ${message}`);
      db.updateMapping(mappingId, { status: "error" });
    }

    // Create hooks if provided
    if (body.hooks) {
      for (const h of body.hooks) {
        db.createHook({
          mappingId,
          type: h.type,
          config: JSON.stringify(h.config),
        });
      }
    }

    // Fire hooks
    const mapping = db.getMapping(mappingId)!;
    await fireHooks(mappingId, {
      mappingId,
      label: mapping.label,
      oldPort: null,
      newPort: mapping.vpnPort,
      destIp: mapping.destIp,
      destPort: mapping.destPort,
    });

    db.logSync("create", mappingId, { vpnPort: mapping.vpnPort, label: mapping.label });

    const hooks = db.listHooks(mappingId);
    return c.json({ mapping: { ...mapping, hooks } }, 201);
  });

  // PUT /mappings/:id
  app.put("/mappings/:id", async (c) => {
    const id = c.req.param("id");
    const parsed = updateMappingSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues }, 400);
    }
    const body = parsed.data;

    const existing = db.getMapping(id);
    if (!existing) {
      return c.json({ error: "Mapping not found" }, 404);
    }

    // Build update object
    const updateFields: Parameters<typeof db.updateMapping>[1] = {};
    if (body.destIp !== undefined) updateFields.destIp = body.destIp;
    if (body.destPort !== undefined) updateFields.destPort = body.destPort;
    if (body.protocol !== undefined) updateFields.protocol = body.protocol;
    if (body.label !== undefined) updateFields.label = body.label;

    if (Object.keys(updateFields).length > 0) {
      db.updateMapping(id, updateFields);
    }

    // Update UniFi rules if destIp or destPort changed
    const destChanged = body.destIp !== undefined || body.destPort !== undefined;
    if (destChanged) {
      const updated = db.getMapping(id)!;
      try {
        if (updated.unifiDnatId) {
          await unifi.updateDnatRule(updated.unifiDnatId, {
            fwd: updated.destIp,
            fwd_port: String(updated.destPort),
          });
        }
        if (updated.unifiFirewallId) {
          await unifi.updateFirewallRule(updated.unifiFirewallId, {
            dst_address: updated.destIp,
            dst_port: String(updated.destPort),
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`UniFi error updating rules for mapping ${id}: ${message}`);
      }
    }

    // Replace hooks if provided
    if (body.hooks !== undefined) {
      const oldHooks = db.listHooks(id);
      for (const h of oldHooks) {
        db.deleteHook(h.id);
      }
      for (const h of body.hooks) {
        db.createHook({
          mappingId: id,
          type: h.type,
          config: JSON.stringify(h.config),
        });
      }
    }

    const mapping = db.getMapping(id)!;
    const hooks = db.listHooks(id);
    return c.json({ mapping: { ...mapping, hooks } });
  });

  // DELETE /mappings/:id
  app.delete("/mappings/:id", async (c) => {
    const id = c.req.param("id");

    const mapping = db.getMapping(id);
    if (!mapping) {
      return c.json({ error: "Mapping not found" }, 404);
    }

    // Delete from provider
    try {
      await provider.deletePort(mapping.vpnPort);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Provider error deleting port ${mapping.vpnPort}: ${message}`);
    }

    // Delete UniFi rules
    try {
      await unifi.login();
      if (mapping.unifiDnatId) {
        await unifi.deleteDnatRule(mapping.unifiDnatId);
      }
      if (mapping.unifiFirewallId) {
        await unifi.deleteFirewallRule(mapping.unifiFirewallId);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`UniFi error deleting rules for mapping ${id}: ${message}`);
    }

    // Fire hooks with newPort: null
    await fireHooks(id, {
      mappingId: id,
      label: mapping.label,
      oldPort: mapping.vpnPort,
      newPort: null,
      destIp: mapping.destIp,
      destPort: mapping.destPort,
    });

    db.deleteMapping(id);
    db.logSync("delete", id, { vpnPort: mapping.vpnPort, label: mapping.label });

    return c.json({ success: true });
  });

  // POST /mappings/:id/refresh
  app.post("/mappings/:id/refresh", async (c) => {
    const id = c.req.param("id");

    const mapping = db.getMapping(id);
    if (!mapping) {
      return c.json({ error: "Mapping not found" }, 404);
    }

    const exists = await provider.checkPort(mapping.vpnPort);
    if (!exists) {
      db.updateMapping(id, { status: "expired" });
      const updated = db.getMapping(id)!;
      return c.json({ mapping: updated, expired: true });
    }

    return c.json({ mapping, expired: false });
  });

  // GET /status
  app.get("/status", async (c) => {
    let providerConnected = false;
    let activePorts = 0;

    try {
      const ports = await provider.listPorts();
      activePorts = ports.length;
      providerConnected = true;
    } catch {
      providerConnected = false;
    }

    let unifiConnected = false;
    try {
      await unifi.login();
      unifiConnected = true;
    } catch {
      unifiConnected = false;
    }

    const allMappings = db.listMappings();
    const activeMappings = allMappings.filter((m) => m.status === "active");

    const recentLogs = db.getRecentLogs(1);
    const lastSync = recentLogs.length > 0 ? recentLogs[0].timestamp : null;

    return c.json({
      provider: {
        connected: providerConnected,
        name: provider.name,
        activePorts,
        maxPorts,
      },
      unifi: {
        connected: unifiConnected,
      },
      mappings: {
        total: allMappings.length,
        active: activeMappings.length,
      },
      lastSync,
    });
  });

  // GET /logs
  app.get("/logs", async (c) => {
    const limitParam = c.req.query("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    const logs = db.getRecentLogs(limit);
    return c.json({ logs });
  });

  return app;
}
