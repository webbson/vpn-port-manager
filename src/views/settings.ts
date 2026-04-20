import type { AppSettings } from "../settings.js";
import type { RouterSettings } from "../routers/types.js";
import type { VpnSettings } from "../settings.js";
import { escHtml } from "./layout.js";

interface SettingsViewProps {
  vpn: VpnSettings | null;
  router: RouterSettings | null;
  app: AppSettings;
  issues?: string[];
}

export function settingsView(props: SettingsViewProps): string {
  const vpnProvider = props.vpn?.provider ?? "azire";
  const vpnInternalIp = props.vpn?.internalIp ?? "";
  const vpnConfigured = props.vpn !== null;

  const routerType = props.router?.type ?? "unifi";
  const routerHost = props.router?.host ?? "";
  const routerUser = props.router?.username ?? "";
  const routerInIface = props.router?.inInterfaceId ?? "";
  const routerSrcZone = props.router?.sourceZoneId ?? "";
  const routerDstZone = props.router?.destinationZoneId ?? "";
  const routerConfigured = props.router !== null;

  const app = props.app;
  const maxPorts = app.maxPorts ?? "";
  const syncIntervalMs = app.syncIntervalMs;
  const renewDays = app.renewThresholdDays;

  return `
    <div class="page-header">
      <h1>Settings</h1>
    </div>

    ${(props.issues && props.issues.length)
      ? `<div class="info-box" style="border-color:#d2992255;background:#3d2f05;color:#d29922;">
           <strong>Stored settings need re-entry.</strong>
           <ul style="margin:8px 0 0 18px;">${props.issues.map((m) => `<li>${escHtml(m)}</li>`).join("")}</ul>
         </div>`
      : ""}

    <div class="info-box">
      Saving any section below requires a <strong>container restart</strong> to take effect.
    </div>

    <h2 class="section-title">VPN provider</h2>
    <form id="vpn-form" class="card" style="margin-bottom:24px;">
      <div class="form-group">
        <label for="vpn-provider">Provider</label>
        <select id="vpn-provider" name="provider">
          <option value="azire"${vpnProvider === "azire" ? " selected" : ""}>Azire VPN</option>
        </select>
      </div>
      <div class="form-group">
        <label for="vpn-apiToken">API token</label>
        <input id="vpn-apiToken" name="apiToken" type="text" placeholder="${vpnConfigured ? "•••••• (stored, leave blank to keep)" : "Bearer token"}" autocomplete="off" />
      </div>
      <div class="form-group">
        <label for="vpn-internalIp">Internal VPN IP</label>
        <input id="vpn-internalIp" name="internalIp" type="text" value="${escHtml(vpnInternalIp)}" placeholder="10.0.16.181" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn primary" onclick="saveVpn()">Save</button>
        <button type="button" class="btn secondary" onclick="testVpn()">Test</button>
        <span id="vpn-result" class="muted"></span>
      </div>
    </form>

    <h2 class="section-title">Router</h2>
    <form id="router-form" class="card" style="margin-bottom:24px;">
      <div class="form-group">
        <label for="router-type">Type</label>
        <select id="router-type" name="type">
          <option value="unifi"${routerType === "unifi" ? " selected" : ""}>UniFi (UDM-Pro)</option>
        </select>
      </div>
      <div class="form-group">
        <label for="router-host">Host</label>
        <input id="router-host" name="host" type="text" value="${escHtml(routerHost)}" placeholder="https://192.168.1.1" />
      </div>
      <div class="form-group">
        <label for="router-username">Username</label>
        <input id="router-username" name="username" type="text" value="${escHtml(routerUser)}" autocomplete="off" />
      </div>
      <div class="form-group">
        <label for="router-password">Password</label>
        <input id="router-password" name="password" type="password" placeholder="${routerConfigured ? "•••••• (stored, leave blank to keep)" : ""}" autocomplete="new-password" />
      </div>
      <div class="info-box">
        Click <strong>Discover</strong> to populate the dropdowns below
        directly from your UniFi controller. Requires host, username and
        password above — password can be blank if already saved.
      </div>
      <div class="form-actions" style="margin-top:0;margin-bottom:14px;">
        <button type="button" class="btn secondary" onclick="discoverRouter()">Discover from UniFi</button>
        <span id="router-discover-result" class="muted"></span>
      </div>
      <div class="form-group">
        <label for="router-inInterfaceId">VPN interface (NAT <code>in_interface</code>)</label>
        <select id="router-inInterfaceId" name="inInterfaceId">
          <option value="${escHtml(routerInIface)}">${routerInIface ? escHtml(routerInIface) + " (saved)" : "— none —"}</option>
        </select>
      </div>
      <div class="form-group">
        <label for="router-sourceZoneId">Firewall source zone (where VPN traffic arrives)</label>
        <select id="router-sourceZoneId" name="sourceZoneId">
          <option value="${escHtml(routerSrcZone)}">${routerSrcZone ? escHtml(routerSrcZone) + " (saved)" : "— none —"}</option>
        </select>
      </div>
      <div class="form-group">
        <label for="router-destinationZoneId">Firewall destination zone (LAN target)</label>
        <select id="router-destinationZoneId" name="destinationZoneId">
          <option value="${escHtml(routerDstZone)}">${routerDstZone ? escHtml(routerDstZone) + " (saved)" : "— none —"}</option>
        </select>
      </div>
      <div class="form-actions">
        <button type="button" class="btn primary" onclick="saveRouter()">Save</button>
        <button type="button" class="btn secondary" onclick="testRouter()">Test</button>
        <span id="router-result" class="muted"></span>
      </div>
    </form>

    <h2 class="section-title">App</h2>
    <form id="app-form" class="card">
      <div class="form-group">
        <label for="app-maxPorts">Max ports (blank = provider default)</label>
        <input id="app-maxPorts" name="maxPorts" type="number" min="1" value="${escHtml(String(maxPorts))}" />
      </div>
      <div class="form-group">
        <label for="app-syncIntervalMs">Sync interval (ms)</label>
        <input id="app-syncIntervalMs" name="syncIntervalMs" type="number" min="1000" value="${escHtml(syncIntervalMs)}" />
      </div>
      <div class="form-group">
        <label for="app-renewDays">Renew threshold (days)</label>
        <input id="app-renewDays" name="renewThresholdDays" type="number" min="1" value="${escHtml(renewDays)}" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn primary" onclick="saveApp()">Save</button>
        <span id="app-result" class="muted"></span>
      </div>
    </form>

    <script>
      ${settingsScript({ vpnConfigured, routerConfigured })}
    </script>
  `;
}

function settingsScript(args: {
  vpnConfigured: boolean;
  routerConfigured: boolean;
}): string {
  return `
    function show(id, msg, ok) {
      const el = document.getElementById(id);
      el.textContent = msg;
      el.style.color = ok ? '#3fb950' : '#f85149';
    }
    function markRestart() {
      localStorage.setItem('restartRequired', '1');
      document.getElementById('restart-banner').classList.add('show');
    }
    function readVpnForm(requireToken) {
      const token = document.getElementById('vpn-apiToken').value.trim();
      if (!token && requireToken) throw new Error('API token required');
      return {
        provider: document.getElementById('vpn-provider').value,
        apiToken: token,
        internalIp: document.getElementById('vpn-internalIp').value.trim(),
      };
    }
    function readRouterForm(requirePassword) {
      const pw = document.getElementById('router-password').value;
      if (!pw && requirePassword) throw new Error('Password required');
      return {
        type: document.getElementById('router-type').value,
        host: document.getElementById('router-host').value.trim(),
        username: document.getElementById('router-username').value.trim(),
        password: pw,
        inInterfaceId: document.getElementById('router-inInterfaceId').value.trim(),
        sourceZoneId: document.getElementById('router-sourceZoneId').value.trim(),
        destinationZoneId: document.getElementById('router-destinationZoneId').value.trim(),
      };
    }
    async function postJson(url, method, body) {
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    }
    async function discoverRouter() {
      const host = document.getElementById('router-host').value.trim();
      const username = document.getElementById('router-username').value.trim();
      const password = document.getElementById('router-password').value;
      show('router-discover-result', 'Discovering…', true);
      const { data } = await postJson('/api/settings/router/discover', 'POST', {
        type: 'unifi', host, username, password,
      });
      if (!data || !data.ok) {
        show('router-discover-result', 'Failed: ' + (data && data.error ? JSON.stringify(data.error) : 'unknown'), false);
        return;
      }
      populateInterfaceSelect(data.interfaces || []);
      populateZoneSelect('router-sourceZoneId', data.zones || []);
      populateZoneSelect('router-destinationZoneId', data.zones || []);
      show('router-discover-result', 'Loaded ' + (data.interfaces ? data.interfaces.length : 0) + ' interfaces, ' + (data.zones ? data.zones.length : 0) + ' zones.', true);
    }
    function populateInterfaceSelect(interfaces) {
      const sel = document.getElementById('router-inInterfaceId');
      const prev = sel.value;
      sel.innerHTML = '';
      for (const iface of interfaces) {
        const opt = document.createElement('option');
        opt.value = iface.id;
        opt.textContent = iface.name + (iface.purpose ? ' (' + iface.purpose + ')' : '') + ' — ' + iface.id;
        if (iface.id === prev) opt.selected = true;
        sel.appendChild(opt);
      }
    }
    function populateZoneSelect(id, zones) {
      const sel = document.getElementById(id);
      const prev = sel.value;
      sel.innerHTML = '';
      for (const zone of zones) {
        const opt = document.createElement('option');
        opt.value = zone.id;
        opt.textContent = zone.name + (zone.key ? ' (' + zone.key + ')' : '') + ' — ' + zone.id;
        if (zone.id === prev) opt.selected = true;
        sel.appendChild(opt);
      }
    }
    async function saveVpn() {
      try {
        const body = readVpnForm(${args.vpnConfigured ? "false" : "true"});
        if (!body.apiToken && ${args.vpnConfigured}) {
          show('vpn-result', 'Nothing to save (token unchanged).', false);
          return;
        }
        const { ok, data } = await postJson('/api/settings/vpn', 'PUT', body);
        if (ok) { show('vpn-result', 'Saved.', true); markRestart(); }
        else show('vpn-result', 'Save failed: ' + JSON.stringify(data), false);
      } catch (e) { show('vpn-result', e.message, false); }
    }
    async function testVpn() {
      try {
        const body = readVpnForm(true);
        show('vpn-result', 'Testing…', true);
        const { data } = await postJson('/api/settings/vpn/test', 'POST', body);
        show('vpn-result', data.ok ? 'Connected.' : ('Failed: ' + (data.error ?? 'unknown')), data.ok);
      } catch (e) { show('vpn-result', e.message, false); }
    }
    async function saveRouter() {
      try {
        const body = readRouterForm(${args.routerConfigured ? "false" : "true"});
        if (!body.password && ${args.routerConfigured}) {
          show('router-result', 'Nothing to save (password unchanged).', false);
          return;
        }
        const { ok, data } = await postJson('/api/settings/router', 'PUT', body);
        if (ok) { show('router-result', 'Saved.', true); markRestart(); }
        else show('router-result', 'Save failed: ' + JSON.stringify(data), false);
      } catch (e) { show('router-result', e.message, false); }
    }
    async function testRouter() {
      try {
        const body = readRouterForm(true);
        show('router-result', 'Testing…', true);
        const { data } = await postJson('/api/settings/router/test', 'POST', body);
        show('router-result', data.ok ? 'Connected.' : ('Failed: ' + (data.error ?? 'unknown')), data.ok);
      } catch (e) { show('router-result', e.message, false); }
    }
    async function saveApp() {
      const maxPortsStr = document.getElementById('app-maxPorts').value.trim();
      const body = {
        maxPorts: maxPortsStr === '' ? null : Number(maxPortsStr),
        syncIntervalMs: Number(document.getElementById('app-syncIntervalMs').value),
        renewThresholdDays: Number(document.getElementById('app-renewDays').value),
      };
      const { ok, data } = await postJson('/api/settings/app', 'PUT', body);
      if (ok) { show('app-result', 'Saved.', true); markRestart(); }
      else show('app-result', 'Save failed: ' + JSON.stringify(data), false);
    }
  `;
}
