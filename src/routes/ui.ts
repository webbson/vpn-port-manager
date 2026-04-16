import { Hono } from 'hono';
import type { Db } from '../db.js';
import type { VpnProvider } from '../providers/types.js';
import type { UnifiClient } from '../unifi/types.js';
import { layout } from '../views/layout.js';
import { dashboardView, type MappingWithHooks, type DashboardStatus } from '../views/dashboard.js';
import { createView } from '../views/create.js';
import { editView } from '../views/edit.js';
import { logsView } from '../views/logs.js';

export interface UiRoutesConfig {
  db: Db;
  provider: VpnProvider;
  unifi: UnifiClient;
  vpnInterface: string;
}

function html(c: { html: (body: string, status?: number) => Response }, body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export function createUiRoutes(config: UiRoutesConfig): Hono {
  const { db, provider, unifi, vpnInterface } = config;
  const app = new Hono();

  // ─── GET / ────────────────────────────────────────────────────────────────
  app.get('/', async (c) => {
    const mappings = db.listMappings();
    const withHooks: MappingWithHooks[] = mappings.map((m) => ({
      ...m,
      hooks: db.listHooks(m.id),
    }));

    let providerConnected = false;
    let activePorts = 0;
    try {
      const ports = await provider.listPorts();
      activePorts = ports.length;
      providerConnected = true;
    } catch { /* ignore */ }

    let unifiConnected = false;
    try {
      await unifi.login();
      unifiConnected = true;
    } catch { /* ignore */ }

    const status: DashboardStatus = {
      provider: {
        connected: providerConnected,
        name: provider.name,
        activePorts,
        maxPorts: provider.maxPorts,
      },
      unifi: { connected: unifiConnected },
    };

    return c.html(layout('Dashboard', dashboardView(withHooks, status)));
  });

  // ─── GET /create ──────────────────────────────────────────────────────────
  app.get('/create', (c) => {
    const maxPorts = provider.maxPorts;
    const current = db.listMappings().filter(
      (m) => m.status !== 'expired' && m.status !== 'error'
    ).length;
    return c.html(layout('New Mapping', createView(maxPorts, current)));
  });

  // ─── POST /create ─────────────────────────────────────────────────────────
  app.post('/create', async (c) => {
    const body = await c.req.parseBody({ all: true });

    const label = String(body['label'] ?? '').trim();
    const destIp = String(body['destIp'] ?? '').trim();
    const destPort = parseInt(String(body['destPort'] ?? '0'), 10);
    const protocol = String(body['protocol'] ?? 'both').trim();

    if (!destIp || !destPort) {
      return c.html(layout('New Mapping', createView(provider.maxPorts,
        db.listMappings().filter((m) => m.status !== 'expired' && m.status !== 'error').length
      )), 400);
    }

    // Parse hooks from form data: hooks[N][field]
    const hooksMap: Record<number, Record<string, string>> = {};
    for (const [key, value] of Object.entries(body)) {
      const m = key.match(/^hooks\[(\d+)\]\[(\w+)\]$/);
      if (m) {
        const idx = parseInt(m[1], 10);
        const field = m[2];
        if (!hooksMap[idx]) hooksMap[idx] = {};
        hooksMap[idx][field] = String(value);
      }
    }

    const hooks = Object.values(hooksMap).filter((h) => h['type']);

    // Allocate port from provider
    const providerPort = await provider.createPort({ expiresInDays: 365 });

    const resolvedLabel = label || `port-${providerPort.port}`;

    // Create DB mapping
    const mappingId = db.createMapping({
      provider: provider.name,
      vpnPort: providerPort.port,
      destIp,
      destPort,
      protocol,
      label: resolvedLabel,
      status: 'pending',
      expiresAt: providerPort.expiresAt,
    });

    // Create UniFi rules
    try {
      await unifi.login();
      const proto = protocol === 'both' ? 'tcp_udp' : protocol;

      const dnatId = await unifi.createDnatRule({
        name: `VPM: ${resolvedLabel}`,
        enabled: true,
        pfwd_interface: vpnInterface,
        src: 'any',
        dst_port: String(providerPort.port),
        fwd: destIp,
        fwd_port: String(destPort),
        proto,
        log: false,
      });

      const fwId = await unifi.createFirewallRule({
        name: `VPM: Allow ${resolvedLabel}`,
        enabled: true,
        ruleset: 'WAN_IN',
        rule_index: 20000,
        action: 'accept',
        protocol: proto,
        src_firewallgroup_ids: [],
        dst_address: destIp,
        dst_port: String(destPort),
        logging: false,
      });

      db.updateMapping(mappingId, { status: 'active', unifiDnatId: dnatId, unifiFirewallId: fwId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`UniFi error creating rules for ${mappingId}: ${msg}`);
      db.updateMapping(mappingId, { status: 'error' });
    }

    // Create hooks
    for (const h of hooks) {
      const { type, ...rest } = h;
      db.createHook({ mappingId, type, config: JSON.stringify(rest) });
    }

    db.logSync('create', mappingId, { vpnPort: providerPort.port, label: resolvedLabel });

    return c.redirect('/');
  });

  // ─── GET /edit/:id ────────────────────────────────────────────────────────
  app.get('/edit/:id', (c) => {
    const id = c.req.param('id');
    const mapping = db.getMapping(id);
    if (!mapping) return c.html(layout('Not Found', '<p>Mapping not found.</p>'), 404);
    const hooks = db.listHooks(id);
    return c.html(layout(`Edit: ${mapping.label}`, editView(mapping, hooks)));
  });

  // ─── POST /edit/:id ───────────────────────────────────────────────────────
  app.post('/edit/:id', async (c) => {
    const id = c.req.param('id');
    const existing = db.getMapping(id);
    if (!existing) return c.html(layout('Not Found', '<p>Mapping not found.</p>'), 404);

    const body = await c.req.parseBody();

    const label = String(body['label'] ?? existing.label).trim();
    const destIp = String(body['destIp'] ?? existing.destIp).trim();
    const destPort = parseInt(String(body['destPort'] ?? existing.destPort), 10);
    const protocol = String(body['protocol'] ?? existing.protocol).trim();

    const updateFields: {
      label?: string; destIp?: string; destPort?: number; protocol?: string;
    } = {};

    if (label && label !== existing.label) updateFields.label = label;
    if (destIp && destIp !== existing.destIp) updateFields.destIp = destIp;
    if (destPort && destPort !== existing.destPort) updateFields.destPort = destPort;
    if (protocol && protocol !== existing.protocol) updateFields.protocol = protocol;

    if (Object.keys(updateFields).length > 0) {
      db.updateMapping(id, updateFields);
    }

    // Update UniFi rules if dest changed
    const destChanged = updateFields.destIp !== undefined || updateFields.destPort !== undefined;
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
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`UniFi error updating rules for ${id}: ${msg}`);
      }
    }

    db.logSync('update', id, { label, destIp, destPort, protocol });

    return c.redirect('/');
  });

  // ─── POST /delete/:id ─────────────────────────────────────────────────────
  app.post('/delete/:id', async (c) => {
    const id = c.req.param('id');
    const mapping = db.getMapping(id);
    if (!mapping) return c.redirect('/');

    // Delete from provider
    try {
      await provider.deletePort(mapping.vpnPort);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Provider error deleting port ${mapping.vpnPort}: ${msg}`);
    }

    // Delete UniFi rules
    try {
      await unifi.login();
      if (mapping.unifiDnatId) await unifi.deleteDnatRule(mapping.unifiDnatId);
      if (mapping.unifiFirewallId) await unifi.deleteFirewallRule(mapping.unifiFirewallId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`UniFi error deleting rules for ${id}: ${msg}`);
    }

    db.deleteMapping(id);
    db.logSync('delete', id, { vpnPort: mapping.vpnPort, label: mapping.label });

    return c.redirect('/');
  });

  // ─── GET /logs ────────────────────────────────────────────────────────────
  app.get('/logs', (c) => {
    const logs = db.getRecentLogs(100);
    return c.html(layout('Logs', logsView(logs)));
  });

  return app;
}
