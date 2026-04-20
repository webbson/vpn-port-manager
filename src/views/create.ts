import { escHtml } from './layout.js';
import { hookBuilder } from './hook-builder.js';

export interface AdoptedPort {
  port: number;
  expiresAt: number;
}

export function createView(
  maxPorts: number,
  currentCount: number,
  adoptedPort?: AdoptedPort
): string {
  const remaining = maxPorts - currentCount;
  const isAdopt = !!adoptedPort;

  // When adopting, the port already exists at the provider — no new slot is
  // consumed, so don't block on a full slot count.
  if (!isAdopt && remaining <= 0) {
    return `
      <div class="page-header">
        <h1>New Port Mapping</h1>
      </div>
      <div class="card">
        <p>You have reached the maximum of <strong>${escHtml(maxPorts)}</strong> port mappings.
           Delete an existing mapping to create a new one.</p>
        <div class="form-actions">
          <a href="/" class="btn secondary">Back to Dashboard</a>
        </div>
      </div>`;
  }

  const header = isAdopt
    ? `<div class="info-box">
         Adopting VPN port <span class="port-num">${escHtml(adoptedPort!.port)}</span> — a new port
         will <strong>not</strong> be allocated at the provider.
       </div>`
    : `<div class="info-box">
         <strong>${escHtml(remaining)}</strong> slot${remaining === 1 ? '' : 's'} remaining
         (${escHtml(currentCount)} / ${escHtml(maxPorts)} used)
       </div>`;

  const adoptInput = isAdopt
    ? `<input type="hidden" name="adoptPort" value="${escHtml(adoptedPort!.port)}" />`
    : '';

  return `
    <div class="page-header">
      <h1>${isAdopt ? 'Adopt VPN Port' : 'New Port Mapping'}</h1>
    </div>

    ${header}

    <div class="card">
      <form method="POST" action="/create">
        ${adoptInput}
        <div class="form-group">
          <label for="label">Label</label>
          <input type="text" id="label" name="label" required
                 placeholder="${isAdopt ? `e.g. port-${adoptedPort!.port}` : 'e.g. Home Server SSH'}" />
        </div>

        <div class="form-group">
          <label for="destIp">Destination IP</label>
          <input type="text" id="destIp" name="destIp" required placeholder="e.g. 192.168.1.100" />
        </div>

        <div class="form-group">
          <label for="destPort">Destination Port</label>
          <input type="number" id="destPort" name="destPort" required
                 min="1" max="65535" placeholder="e.g. 22" />
        </div>

        <div class="form-group">
          <label for="protocol">Protocol</label>
          <select id="protocol" name="protocol">
            <option value="both">TCP + UDP</option>
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
          </select>
        </div>

        ${hookBuilder()}

        <div class="form-actions">
          <button type="submit" class="btn primary">${isAdopt ? 'Adopt Port' : 'Create Mapping'}</button>
          <a href="/" class="btn secondary">Cancel</a>
        </div>
      </form>
    </div>`;
}
