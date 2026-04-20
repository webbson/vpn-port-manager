import type { PortMapping, Hook } from '../db.js';
import { escHtml } from './layout.js';

export interface DashboardStatus {
  provider: {
    connected: boolean;
    name: string;
    activePorts: number;
    maxPorts: number;
  };
  router: {
    connected: boolean;
    name: string;
  };
  externalIp: string | null;
}

export type MappingWithHooks = PortMapping & { hooks: Hook[] };

export interface DanglingPortRow {
  port: number;
  expiresAt: number;
}

// expiresAt is a unix timestamp in seconds (provider convention — see azire/client.ts).
function formatExpiry(expiresAtSeconds: number): string {
  const expiresMs = expiresAtSeconds * 1000;
  const diffMs = expiresMs - Date.now();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs <= 0) return '<span class="muted">Expired</span>';
  if (diffDays < 90) return `${diffDays}d left`;

  return new Date(expiresMs).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function hookLabel(h: Hook): string {
  if (h.type === 'plugin') {
    try {
      const cfg = JSON.parse(h.config) as Record<string, unknown>;
      if (typeof cfg.plugin === 'string' && cfg.plugin.length > 0) return cfg.plugin;
    } catch {
      // fall through
    }
  }
  return h.type;
}

function hookSummary(hooks: Hook[]): string {
  if (hooks.length === 0) return '<span class="muted">—</span>';
  const labels = [...new Set(hooks.map(hookLabel))].map((l) => escHtml(l));
  return labels.join(', ');
}

function badgeFor(status: string): string {
  const safe = escHtml(status);
  const cls = ['active', 'pending', 'error', 'expired'].includes(status) ? status : 'pending';
  return `<span class="badge ${cls}">${safe}</span>`;
}

function portCell(port: number, externalIp: string | null): string {
  if (!externalIp) {
    return `<span class="port-num">${escHtml(port)}</span>`;
  }
  const copy = `${externalIp}:${port}`;
  return `<button type="button" class="port-copy port-num" data-copy="${escHtml(copy)}" title="Click to copy ${escHtml(copy)}">${escHtml(port)}</button>`;
}

function mappingRow(m: MappingWithHooks, externalIp: string | null): string {
  return `
    <tr>
      <td>${escHtml(m.label)}</td>
      <td>${portCell(m.vpnPort, externalIp)}</td>
      <td>${escHtml(m.destIp)}:<span class="port-num">${escHtml(m.destPort)}</span></td>
      <td>${escHtml(m.protocol)}</td>
      <td>${badgeFor(m.status)}</td>
      <td>${formatExpiry(m.expiresAt)}</td>
      <td>${hookSummary(m.hooks)}</td>
      <td>
        <div style="display:flex;gap:8px;align-items:center;">
          <a href="/edit/${escHtml(m.id)}" class="btn secondary">Edit</a>
          <form method="POST" action="/delete/${escHtml(m.id)}" style="margin:0;"
                onsubmit="return confirm('Delete mapping ${escHtml(m.label.replace(/'/g, "\\'"))}?')">
            <button type="submit" class="btn danger">Delete</button>
          </form>
        </div>
      </td>
    </tr>`;
}

function danglingRow(p: DanglingPortRow): string {
  return `
    <tr>
      <td><span class="port-num">${escHtml(p.port)}</span></td>
      <td>${formatExpiry(p.expiresAt)}</td>
      <td>
        <div style="display:flex;gap:8px;align-items:center;">
          <a href="/create?adopt=${escHtml(p.port)}" class="btn secondary">Adopt</a>
          <form method="POST" action="/dangling/${escHtml(p.port)}/release" style="margin:0;"
                onsubmit="return confirm('Release port ${escHtml(p.port)} at the VPN provider? This cannot be undone.')">
            <button type="submit" class="btn danger">Release</button>
          </form>
        </div>
      </td>
    </tr>`;
}

export function dashboardView(
  mappings: MappingWithHooks[],
  status: DashboardStatus,
  danglingPorts: DanglingPortRow[] = []
): string {
  const providerDot = status.provider.connected ? 'ok' : 'err';
  const providerLabel = status.provider.connected ? 'Connected' : 'Disconnected';
  const routerDot = status.router.connected ? 'ok' : 'err';
  const routerLabel = status.router.connected ? 'Connected' : 'Disconnected';
  const routerTitle = status.router.name === 'unifi' ? 'UniFi Controller' : `${status.router.name} router`;

  const tableBody = mappings.length === 0
    ? `<tr><td colspan="8">
        <div class="empty-state">
          No port mappings yet. <a href="/create">Create one</a>
        </div>
       </td></tr>`
    : mappings.map((m) => mappingRow(m, status.externalIp)).join('');

  const danglingSection = danglingPorts.length === 0 ? '' : `
    <div class="table-wrap" style="margin-top:28px;">
      <div class="table-header">
        <h2>Dangling Ports</h2>
        <span class="muted">${danglingPorts.length} at provider, not tracked here</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>VPN Port</th>
            <th>Expires</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${danglingPorts.map(danglingRow).join('')}
        </tbody>
      </table>
    </div>`;

  return `
    <div class="page-header">
      <h1>Dashboard</h1>
      <a href="/create" class="btn primary">+ New Mapping</a>
    </div>

    <div class="cards-row">
      <div class="card">
        <h3>${escHtml(status.provider.name)} Provider</h3>
        <div class="health">
          <span class="health-dot ${providerDot}"></span>
          ${providerLabel}
        </div>
        <div style="margin-top:10px;font-size:13px;color:#8b949e;">
          ${escHtml(status.provider.activePorts)} / ${escHtml(status.provider.maxPorts)} ports used
        </div>
      </div>
      <div class="card">
        <h3>${escHtml(routerTitle)}</h3>
        <div class="health">
          <span class="health-dot ${routerDot}"></span>
          ${routerLabel}
        </div>
      </div>
      <div class="card">
        <h3>External IP</h3>
        ${status.externalIp
          ? `<div class="health"><span class="health-dot ok"></span><span class="port-num">${escHtml(status.externalIp)}</span></div>
             <div style="margin-top:10px;font-size:13px;color:#8b949e;">as seen by the internet from this container</div>`
          : `<div class="health"><span class="health-dot err"></span>Unavailable</div>
             <div style="margin-top:10px;font-size:13px;color:#8b949e;">lookup failed — VPN may be down</div>`}
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-header">
        <h2>Port Mappings</h2>
        <span class="muted">${mappings.length} total</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Label</th>
            <th>VPN Port</th>
            <th>Destination</th>
            <th>Protocol</th>
            <th>Status</th>
            <th>Expires</th>
            <th>Hooks</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${tableBody}
        </tbody>
      </table>
    </div>

    ${danglingSection}`;
}
