import { Hono } from 'hono';
import type { Db, RouterHandle } from '../db.js';
import type { PortForwardSpec, Protocol } from '../routers/types.js';
import { layout } from '../views/layout.js';
import { dashboardView, type MappingWithHooks, type DashboardStatus } from '../views/dashboard.js';
import { getExternalIp } from '../services/external-ip.js';
import { createView } from '../views/create.js';
import { editView } from '../views/edit.js';
import { logsView } from '../views/logs.js';
import type { Runtime } from '../runtime.js';
import { listDanglingPorts } from '../services/dangling-ports.js';

export interface UiRoutesConfig {
  db: Db;
  runtime: Runtime;
}

function toRouterProtocol(p: string): Protocol {
  if (p === 'tcp' || p === 'udp') return p;
  return 'tcp_udp';
}

function buildSpec(m: {
  vpnPort: number;
  destIp: string;
  destPort: number;
  protocol: string;
  label: string;
}): PortForwardSpec {
  return {
    vpnPort: m.vpnPort,
    destIp: m.destIp,
    destPort: m.destPort,
    protocol: toRouterProtocol(m.protocol),
    label: m.label,
  };
}

export function createUiRoutes(config: UiRoutesConfig): Hono {
  const { db, runtime } = config;
  const app = new Hono();

  app.get('/', async (c) => {
    const provider = runtime.getProvider();
    const router = runtime.getRouter();
    const mappings = db.listMappings();
    const withHooks: MappingWithHooks[] = mappings.map((m) => ({
      ...m,
      hooks: db.listHooks(m.id),
    }));

    let providerConnected = false;
    let activePorts = 0;
    let providerPorts: { port: number; expiresAt: number }[] = [];
    try {
      providerPorts = await provider.listPorts();
      activePorts = providerPorts.length;
      providerConnected = true;
    } catch { /* ignore */ }

    const trackedPorts = new Set(
      mappings.filter((m) => m.status !== 'expired').map((m) => m.vpnPort)
    );
    const danglingPorts = providerPorts.filter((p) => !trackedPorts.has(p.port));

    const [routerTest, externalIp] = await Promise.all([
      router.testConnection(),
      getExternalIp(),
    ]);

    const status: DashboardStatus = {
      provider: {
        connected: providerConnected,
        name: provider.name,
        activePorts,
        maxPorts: runtime.getMaxPorts(),
      },
      router: { connected: routerTest.ok, name: router.name },
      externalIp: externalIp.ip,
    };

    return c.html(layout('Dashboard', dashboardView(withHooks, status, danglingPorts)));
  });

  app.get('/create', async (c) => {
    const provider = runtime.getProvider();
    const maxPorts = runtime.getMaxPorts();
    const current = db.listMappings().filter(
      (m) => m.status !== 'expired' && m.status !== 'error'
    ).length;

    const adoptParam = c.req.query('adopt');
    if (adoptParam) {
      const adoptPort = parseInt(adoptParam, 10);
      if (!Number.isFinite(adoptPort) || adoptPort <= 0) {
        return c.html(layout('New Mapping', '<p>Invalid adopt port.</p>'), 400);
      }
      try {
        const dangling = await listDanglingPorts(provider, db);
        const match = dangling.find((p) => p.port === adoptPort);
        if (!match) {
          return c.html(
            layout('New Mapping', `<p>Port ${adoptPort} is not a dangling port. <a href="/">Back</a></p>`),
            404
          );
        }
        return c.html(
          layout('New Mapping', createView(maxPorts, current, { port: match.port, expiresAt: match.expiresAt }))
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return c.html(
          layout('New Mapping', `<p>Could not reach provider: ${message}. <a href="/">Back</a></p>`),
          502
        );
      }
    }

    return c.html(layout('New Mapping', createView(maxPorts, current)));
  });

  app.post('/create', async (c) => {
    const provider = runtime.getProvider();
    const router = runtime.getRouter();
    const body = await c.req.parseBody({ all: true });

    const label = String(body['label'] ?? '').trim();
    const destIp = String(body['destIp'] ?? '').trim();
    const destPort = parseInt(String(body['destPort'] ?? '0'), 10);
    const protocol = String(body['protocol'] ?? 'both').trim();
    const adoptPortRaw = body['adoptPort'] ? String(body['adoptPort']) : '';
    const adoptPort = adoptPortRaw ? parseInt(adoptPortRaw, 10) : null;

    if (!destIp || !destPort) {
      return c.html(layout('New Mapping', createView(runtime.getMaxPorts(),
        db.listMappings().filter((m) => m.status !== 'expired' && m.status !== 'error').length
      )), 400);
    }

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

    let providerPort: { port: number; expiresAt: number };
    if (adoptPort && Number.isFinite(adoptPort)) {
      const dangling = await listDanglingPorts(provider, db);
      const match = dangling.find((p) => p.port === adoptPort);
      if (!match) {
        return c.html(
          layout('New Mapping', `<p>Port ${adoptPort} is no longer available to adopt. <a href="/">Back</a></p>`),
          409
        );
      }
      providerPort = { port: match.port, expiresAt: match.expiresAt };
    } else {
      providerPort = await provider.createPort({ expiresInDays: 365 });
    }
    const resolvedLabel = label || `port-${providerPort.port}`;

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

    try {
      const handle = await router.ensurePortForward(
        buildSpec({
          vpnPort: providerPort.port,
          destIp,
          destPort,
          protocol,
          label: resolvedLabel,
        })
      );
      db.updateMapping(mappingId, { status: 'active', routerHandle: handle });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Router error creating rules for ${mappingId}: ${msg}`);
      db.updateMapping(mappingId, { status: 'error' });
    }

    for (const h of hooks) {
      const { type, ...rest } = h;
      db.createHook({ mappingId, type, config: JSON.stringify(rest) });
    }

    db.logSync('create', mappingId, { vpnPort: providerPort.port, label: resolvedLabel });

    return c.redirect('/');
  });

  app.get('/edit/:id', (c) => {
    const id = c.req.param('id');
    const mapping = db.getMapping(id);
    if (!mapping) return c.html(layout('Not Found', '<p>Mapping not found.</p>'), 404);
    const hooks = db.listHooks(id);
    return c.html(layout(`Edit: ${mapping.label}`, editView(mapping, hooks)));
  });

  app.post('/edit/:id', async (c) => {
    const router = runtime.getRouter();
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

    const destChanged =
      updateFields.destIp !== undefined ||
      updateFields.destPort !== undefined ||
      updateFields.protocol !== undefined;
    if (destChanged) {
      const updated = db.getMapping(id)!;
      try {
        const handle = await router.updatePortForward(
          updated.routerHandle as RouterHandle,
          buildSpec(updated)
        );
        db.updateMapping(id, { routerHandle: handle });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Router error updating rules for ${id}: ${msg}`);
      }
    }

    db.logSync('update', id, { label, destIp, destPort, protocol });

    return c.redirect('/');
  });

  app.post('/delete/:id', async (c) => {
    const provider = runtime.getProvider();
    const router = runtime.getRouter();
    const id = c.req.param('id');
    const mapping = db.getMapping(id);
    if (!mapping) return c.redirect('/');

    try {
      await provider.deletePort(mapping.vpnPort);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Provider error deleting port ${mapping.vpnPort}: ${msg}`);
    }

    try {
      await router.deletePortForward(mapping.routerHandle as RouterHandle);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Router error deleting rules for ${id}: ${msg}`);
    }

    db.deleteMapping(id);
    db.logSync('delete', id, { vpnPort: mapping.vpnPort, label: mapping.label });

    return c.redirect('/');
  });

  app.post('/dangling/:port/release', async (c) => {
    const provider = runtime.getProvider();
    const port = parseInt(c.req.param('port'), 10);
    if (!Number.isFinite(port) || port <= 0) return c.redirect('/');

    const dangling = await listDanglingPorts(provider, db);
    if (!dangling.some((p) => p.port === port)) return c.redirect('/');

    try {
      await provider.deletePort(port);
      db.logSync('dangling_release', null, { vpnPort: port });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Provider error releasing dangling port ${port}: ${msg}`);
    }
    return c.redirect('/');
  });

  app.get('/logs', (c) => {
    const logs = db.getRecentLogs(100);
    return c.html(layout('Logs', logsView(logs)));
  });

  return app;
}
