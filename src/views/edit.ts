import type { PortMapping, Hook } from '../db.js';
import { escHtml } from './layout.js';
import { hookBuilder } from './hook-builder.js';

function hookStatusLine(hooks: Hook[]): string {
  const errored = hooks.filter((h) => h.lastStatus && h.lastStatus !== 'success' && h.lastStatus !== 'ok');
  if (errored.length === 0) return '';
  const items = errored
    .map((h) => `<li><strong>${escHtml(h.type)}</strong>${h.lastError ? ': ' + escHtml(h.lastError) : ''}</li>`)
    .join('');
  return `
    <div class="info-box" style="border-color:#f8514955;background:#4e1e1e22;color:#f85149;">
      <strong>Last-run errors:</strong>
      <ul style="margin:6px 0 0 18px;">${items}</ul>
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

    ${hookStatusLine(hooks)}

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
