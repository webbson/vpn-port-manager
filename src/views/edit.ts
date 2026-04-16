import type { PortMapping, Hook } from '../db.js';
import { escHtml } from './layout.js';

function hookConfigSummary(hook: Hook): string {
  try {
    const cfg = JSON.parse(hook.config) as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(cfg)) {
      if (v !== null && v !== undefined && v !== '') {
        parts.push(`${escHtml(k)}: ${escHtml(String(v))}`);
      }
    }
    return parts.join(', ') || '—';
  } catch {
    return escHtml(hook.config);
  }
}

function hookStatusBadge(hook: Hook): string {
  if (!hook.lastStatus) return '<span class="muted">never run</span>';
  const cls = hook.lastStatus === 'success' ? 'active' : 'error';
  return `<span class="badge ${cls}">${escHtml(hook.lastStatus)}</span>`;
}

export function editView(mapping: PortMapping, hooks: Hook[]): string {
  const protocolOption = (value: string, label: string) => {
    const sel = mapping.protocol === value ? ' selected' : '';
    return `<option value="${escHtml(value)}"${sel}>${escHtml(label)}</option>`;
  };

  const hooksList = hooks.length === 0
    ? '<p class="muted">No hooks configured.</p>'
    : hooks.map((h) => `
        <div class="hook-item">
          <div>
            <div class="hook-type">${escHtml(h.type)}</div>
            <div class="hook-config">${hookConfigSummary(h)}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            ${hookStatusBadge(h)}
            ${h.lastError ? `<div style="font-size:11px;color:#f85149;margin-top:4px;">${escHtml(h.lastError)}</div>` : ''}
          </div>
        </div>`).join('');

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

    <div class="card" style="margin-bottom:24px;">
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

        <div class="form-actions">
          <button type="submit" class="btn primary">Save Changes</button>
          <a href="/" class="btn secondary">Cancel</a>
        </div>
      </form>
    </div>

    <div class="section-title">Configured Hooks</div>
    ${hooksList}`;
}
