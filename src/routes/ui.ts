import { Hono } from 'hono';
import type { Db, RouterHandle } from '../db.js';
import type { PortForwardSpec, Protocol } from '../routers/types.js';
import { layout } from '../views/layout.js';
import { dashboardView, type MappingWithHooks, type DashboardStatus } from '../views/dashboard.js';
import { getExternalIp } from '../services/external-ip.js';
import { createView } from '../views/create.js';
import { editView } from '../views/edit.js';
import { logsView } from '../views/logs.js';
import { parseHookForm } from '../views/hook-builder.js';
import type { Runtime } from '../runtime.js';
import { listDanglingPorts } from '../services/dangling-ports.js';
import { createHookRunner } from '../hooks/runner.js';
import { fireHooksForMapping } from '../hooks/fire.js';

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
  const hookRunner = createHookRunner();
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

    const hooks = parseHookForm(body as Record<string, unknown>);

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
      db.createHook({ mappingId, type: h.type, config: h.config });
    }

    db.logSync('create', mappingId, { vpnPort: providerPort.port, label: resolvedLabel });

    const created = db.getMapping(mappingId)!;
    await fireHooksForMapping(db, hookRunner, mappingId, {
      mappingId,
      label: created.label,
      oldPort: null,
      newPort: created.vpnPort,
      destIp: created.destIp,
      destPort: created.destPort,
    });

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

    const body = await c.req.parseBody({ all: true });

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

    // Replace the full hook set. The form includes only the hooks the user
    // left on the page, so anything missing from the submission was removed.
    const incomingHooks = parseHookForm(body as Record<string, unknown>);
    const existingHooks = db.listHooks(id);
    for (const h of existingHooks) db.deleteHook(h.id);
    for (const h of incomingHooks) {
      db.createHook({ mappingId: id, type: h.type, config: h.config });
    }

    db.logSync('update', id, { label, destIp, destPort, protocol, hookCount: incomingHooks.length });

    // Fire hooks that haven't run yet (new ones added via this edit) so the
    // user doesn't have to wait for a port change or a sync retry to see the
    // integration work. Existing hooks with a prior lastStatus aren't re-run
    // here — avoid spamming Plex/webhooks on every label tweak.
    const freshMapping = db.getMapping(id)!;
    const neverRun = db.listHooks(id).filter((h) => h.lastStatus === null);
    if (neverRun.length > 0) {
      await fireHooksForMapping(
        db,
        hookRunner,
        id,
        {
          mappingId: id,
          label: freshMapping.label,
          oldPort: null,
          newPort: freshMapping.vpnPort,
          destIp: freshMapping.destIp,
          destPort: freshMapping.destPort,
        },
        { hookIds: new Set(neverRun.map((h) => h.id)) }
      );
    }

    return c.redirect('/');
  });

  app.post('/delete/:id', async (c) => {
    const provider = runtime.getProvider();
    const router = runtime.getRouter();
    const id = c.req.param('id');
    const mapping = db.getMapping(id);
    if (!mapping) return c.redirect('/');

    // Fire hooks with newPort=null before the cascade delete wipes them.
    await fireHooksForMapping(db, hookRunner, id, {
      mappingId: id,
      label: mapping.label,
      oldPort: mapping.vpnPort,
      newPort: null,
      destIp: mapping.destIp,
      destPort: mapping.destPort,
    });

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

  app.post('/hooks/:hookId/fire', async (c) => {
    const hookId = c.req.param('hookId');
    // Find the mapping that owns this hook. The hooks table doesn't have a
    // direct "get by id" helper, so walk mappings — cheap at our scale.
    let ownerMapping = null;
    let hookBelongs = false;
    for (const m of db.listMappings()) {
      for (const h of db.listHooks(m.id)) {
        if (h.id === hookId) { ownerMapping = m; hookBelongs = true; break; }
      }
      if (hookBelongs) break;
    }
    if (!ownerMapping) return c.redirect('/');

    await fireHooksForMapping(
      db,
      hookRunner,
      ownerMapping.id,
      {
        mappingId: ownerMapping.id,
        label: ownerMapping.label,
        oldPort: null,
        newPort: ownerMapping.vpnPort,
        destIp: ownerMapping.destIp,
        destPort: ownerMapping.destPort,
      },
      { hookIds: new Set([hookId]) }
    );

    return c.redirect(`/edit/${ownerMapping.id}`);
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
