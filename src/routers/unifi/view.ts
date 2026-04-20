import { escHtml } from "../../views/layout.js";
import type { UnifiRouterSettings } from "./schema.js";

export function unifiFields(stored: UnifiRouterSettings | null): string {
  const configured = stored !== null;
  const host = stored?.host ?? "";
  const username = stored?.username ?? "";
  const inIface = stored?.inInterfaceId ?? "";
  const srcZone = stored?.sourceZoneId ?? "";
  const dstZone = stored?.destinationZoneId ?? "";

  return `
    <div class="form-group">
      <label for="unifi-host">Host</label>
      <input id="unifi-host" name="host" type="text" value="${escHtml(host)}" placeholder="https://192.168.1.1" />
    </div>
    <div class="form-group">
      <label for="unifi-username">Username</label>
      <input id="unifi-username" name="username" type="text" value="${escHtml(username)}" autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="unifi-password">Password</label>
      <input id="unifi-password" name="password" type="password" placeholder="${configured ? "•••••• (stored, leave blank to keep)" : ""}" autocomplete="new-password" />
    </div>

    <div class="info-box">
      Click <strong>Discover</strong> to pull interfaces + zones from UniFi.
      Password can be blank if one is already stored.
    </div>
    <div class="form-actions" style="margin-top:0;margin-bottom:14px;">
      <button type="button" class="btn secondary" onclick="discoverUnifi()">Discover from UniFi</button>
      <span id="unifi-discover-result" class="muted"></span>
    </div>
    <div class="form-group">
      <label for="unifi-inInterfaceId">VPN interface</label>
      <select id="unifi-inInterfaceId" name="inInterfaceId">
        <option value="${escHtml(inIface)}">${inIface ? escHtml(inIface) + " (saved)" : "— run Discover first —"}</option>
      </select>
    </div>
    <div class="form-group">
      <label for="unifi-sourceZoneId">Firewall source zone (where VPN traffic arrives)</label>
      <select id="unifi-sourceZoneId" name="sourceZoneId">
        <option value="${escHtml(srcZone)}">${srcZone ? escHtml(srcZone) + " (saved)" : "— run Discover first —"}</option>
      </select>
    </div>
    <div class="form-group">
      <label for="unifi-destinationZoneId">Firewall destination zone (LAN target)</label>
      <select id="unifi-destinationZoneId" name="destinationZoneId">
        <option value="${escHtml(dstZone)}">${dstZone ? escHtml(dstZone) + " (saved)" : "— run Discover first —"}</option>
      </select>
    </div>
  `;
}

export const UNIFI_READER_NAME = "readUnifiForm";

export const unifiReaderScript = `
  function ${UNIFI_READER_NAME}(opts) {
    const requireSecret = opts && opts.requireSecret;
    const pw = document.getElementById('unifi-password').value;
    if (!pw && requireSecret) throw new Error('Password required');
    return {
      type: 'unifi',
      host: document.getElementById('unifi-host').value.trim(),
      username: document.getElementById('unifi-username').value.trim(),
      password: pw,
      inInterfaceId: document.getElementById('unifi-inInterfaceId').value.trim(),
      sourceZoneId: document.getElementById('unifi-sourceZoneId').value.trim(),
      destinationZoneId: document.getElementById('unifi-destinationZoneId').value.trim(),
    };
  }
  async function discoverUnifi() {
    const statusId = 'unifi-discover-result';
    const host = document.getElementById('unifi-host').value.trim();
    const username = document.getElementById('unifi-username').value.trim();
    const password = document.getElementById('unifi-password').value;
    const show = (msg, ok) => {
      const el = document.getElementById(statusId);
      el.textContent = msg;
      el.style.color = ok ? '#3fb950' : '#f85149';
    };
    show('Discovering…', true);
    const res = await fetch('/api/settings/router/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'unifi', host, username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data || !data.ok) {
      show('Failed: ' + (data && data.error ? JSON.stringify(data.error) : 'unknown'), false);
      return;
    }
    function populate(id, items, isInterface) {
      const sel = document.getElementById(id);
      const prev = sel.value;
      sel.innerHTML = '';
      for (const it of items) {
        const opt = document.createElement('option');
        opt.value = it.id;
        const extra = isInterface
          ? (it.purpose ? ' (' + it.purpose + ')' : '')
          : (it.key ? ' (' + it.key + ')' : '');
        opt.textContent = it.name + extra + ' — ' + it.id;
        if (it.id === prev) opt.selected = true;
        sel.appendChild(opt);
      }
    }
    populate('unifi-inInterfaceId', data.interfaces || [], true);
    populate('unifi-sourceZoneId', data.zones || [], false);
    populate('unifi-destinationZoneId', data.zones || [], false);
    show('Loaded ' + (data.interfaces ? data.interfaces.length : 0) + ' interfaces, ' + (data.zones ? data.zones.length : 0) + ' zones.', true);
  }
`;
