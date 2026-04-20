import type { PortMapping, Hook } from '../db.js';
import { escHtml } from './layout.js';
import { hookBuilder } from './hook-builder.js';

function hookStatusBadge(h: Hook): string {
  if (!h.lastStatus) return '<span class="muted">never run</span>';
  const ok = h.lastStatus === 'success' || h.lastStatus === 'ok';
  const cls = ok ? 'active' : 'error';
  return `<span class="badge ${cls}">${escHtml(h.lastStatus)}</span>`;
}

function existingHooksPanel(hooks: Hook[]): string {
  if (hooks.length === 0) return '';
  const rows = hooks.map((h) => {
    const plugin = (() => {
      try {
        const cfg = JSON.parse(h.config) as Record<string, unknown>;
        return typeof cfg.plugin === 'string' ? cfg.plugin : '';
      } catch { return ''; }
    })();
    const typeLabel = h.type === 'plugin' && plugin ? `${plugin}` : h.type;
    const errLine = h.lastError
      ? `<div class="form-help" style="color:#f85149;">${escHtml(h.lastError)}</div>`
      : '';
    return `
      <div class="hook-item">
        <div style="flex:1;min-width:0;">
          <div class="hook-type">${escHtml(typeLabel)}</div>
          <div>${hookStatusBadge(h)}</div>
          ${errLine}
        </div>
        <form method="POST" action="/hooks/${escHtml(h.id)}/fire" style="margin:0;flex-shrink:0;">
          <button type="submit" class="btn secondary" title="Run this hook now with the current port">Fire now</button>
        </form>
      </div>`;
  }).join('');
  return `
    <div class="section-title" style="margin-top:0;">Existing hooks</div>
    <div style="margin-bottom:20px;">${rows}</div>
    <div class="form-help" style="margin-top:-12px;margin-bottom:20px;">
      Firing uses the mapping's current port (oldPort = null, newPort = current).
      To add or remove hooks, edit the list below and save.
    </div>`;
}

export function editView(mapping: PortMapping, hooks: Hook[]): string {
  const protocolOption = (value: string, label: string) => {
    const sel = mapping.protocol === value ? ' selected' : '';
    return `<option value="${escHtml(value)}"${sel}>${escHtml(label)}</option>`;
  };

  return `
    <div class="page-header">
      <h1>Edit Mapping</h1>
      <a href="/" class="btn secondary">Back</a>
    </div>

    <div class="info-box">
      VPN Port: <strong class="port-num">${escHtml(mapping.vpnPort)}</strong>
      &nbsp;&middot;&nbsp;
      Provider: <strong>${escHtml(mapping.provider)}</strong>
      &nbsp;&middot;&nbsp;
      Status: <span class="badge ${['active','pending','error','expired'].includes(mapping.status) ? mapping.status : 'pending'}">${escHtml(mapping.status)}</span>
    </div>

    ${existingHooksPanel(hooks)}

    <div class="card">
      <form method="POST" action="/edit/${escHtml(mapping.id)}">
        <div class="form-group">
          <label for="label">Label</label>
          <input type="text" id="label" name="label" value="${escHtml(mapping.label)}" required />
        </div>

        <div class="form-group">
          <label for="destIp">Destination IP</label>
          <input type="text" id="destIp" name="destIp" value="${escHtml(mapping.destIp)}" required />
        </div>

        <div class="form-group">
          <label for="destPort">Destination Port</label>
          <input type="number" id="destPort" name="destPort"
                 value="${escHtml(mapping.destPort)}" required min="1" max="65535" />
        </div>

        <div class="form-group">
          <label for="protocol">Protocol</label>
          <select id="protocol" name="protocol">
            ${protocolOption('both', 'TCP + UDP')}
            ${protocolOption('tcp', 'TCP')}
            ${protocolOption('udp', 'UDP')}
          </select>
        </div>

        ${hookBuilder(hooks)}

        <div class="form-actions">
          <button type="submit" class="btn primary">Save Changes</button>
          <a href="/" class="btn secondary">Cancel</a>
        </div>
      </form>
    </div>`;
}
