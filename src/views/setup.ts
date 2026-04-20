import { escHtml } from "./layout.js";

export function setupView(props: { issues?: string[] } = {}): string {
  const issues = props.issues ?? [];
  const staleBanner = issues.length
    ? `<div class="info-box" style="border-color:#d2992255;background:#3d2f05;color:#d29922;">
         <strong>Previously-saved settings need re-entry.</strong>
         <ul style="margin:8px 0 0 18px;">${issues.map((m) => `<li>${escHtml(m)}</li>`).join("")}</ul>
       </div>`
    : "";
  return `
    <div class="page-header">
      <h1>Set up VPN Port Manager</h1>
    </div>

    ${staleBanner}

    <div class="info-box">
      Enter your VPN provider credentials and router details below. Once both sections are saved,
      <strong>restart the container</strong> to switch out of setup mode and reach the dashboard.
    </div>

    <h2 class="section-title">1. VPN provider</h2>
    <form id="vpn-form" class="card" style="margin-bottom:24px;">
      <div class="form-group">
        <label for="vpn-provider">Provider</label>
        <select id="vpn-provider" name="provider"><option value="azire" selected>Azire VPN</option></select>
      </div>
      <div class="form-group">
        <label for="vpn-apiToken">API token</label>
        <input id="vpn-apiToken" name="apiToken" type="text" autocomplete="off" placeholder="Bearer token from the provider" />
      </div>
      <div class="form-group">
        <label for="vpn-internalIp">Internal VPN IP</label>
        <input id="vpn-internalIp" name="internalIp" type="text" placeholder="10.0.16.181" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn primary" onclick="saveVpn()">Save VPN</button>
        <button type="button" class="btn secondary" onclick="testVpn()">Test</button>
        <span id="vpn-result" class="muted"></span>
      </div>
    </form>

    <h2 class="section-title">2. Router</h2>
    <form id="router-form" class="card" style="margin-bottom:24px;">
      <div class="form-group">
        <label for="router-type">Type</label>
        <select id="router-type" name="type"><option value="unifi" selected>UniFi (UDM-Pro)</option></select>
      </div>
      <div class="form-group">
        <label for="router-host">Host</label>
        <input id="router-host" name="host" type="text" placeholder="https://192.168.1.1" />
      </div>
      <div class="form-group">
        <label for="router-username">Username</label>
        <input id="router-username" name="username" type="text" autocomplete="off" />
      </div>
      <div class="form-group">
        <label for="router-password">Password</label>
        <input id="router-password" name="password" type="password" autocomplete="new-password" />
      </div>
      <div class="info-box">
        Click <strong>Discover</strong> to pull interfaces + zones from UniFi.
        Needs the host, username and password above first.
      </div>
      <div class="form-actions" style="margin-top:0;margin-bottom:14px;">
        <button type="button" class="btn secondary" onclick="discoverRouter()">Discover from UniFi</button>
        <span id="router-discover-result" class="muted"></span>
      </div>
      <div class="form-group">
        <label for="router-inInterfaceId">VPN interface</label>
        <select id="router-inInterfaceId" name="inInterfaceId"><option value="">— run Discover first —</option></select>
      </div>
      <div class="form-group">
        <label for="router-sourceZoneId">Firewall source zone (where VPN traffic arrives)</label>
        <select id="router-sourceZoneId" name="sourceZoneId"><option value="">— run Discover first —</option></select>
      </div>
      <div class="form-group">
        <label for="router-destinationZoneId">Firewall destination zone (LAN target)</label>
        <select id="router-destinationZoneId" name="destinationZoneId"><option value="">— run Discover first —</option></select>
      </div>
      <div class="form-actions">
        <button type="button" class="btn primary" onclick="saveRouter()">Save router</button>
        <button type="button" class="btn secondary" onclick="testRouter()">Test</button>
        <span id="router-result" class="muted"></span>
      </div>
    </form>

    <div class="info-box" id="done-box" style="display:none;">
      <strong>Setup complete.</strong> Restart the container to finish (e.g. on Unraid: Docker tab → Restart).
    </div>

    <script>
      function show(id, msg, ok) {
        const el = document.getElementById(id); el.textContent = msg;
        el.style.color = ok ? '#3fb950' : '#f85149';
      }
      function readVpn() {
        return {
          provider: document.getElementById('vpn-provider').value,
          apiToken: document.getElementById('vpn-apiToken').value.trim(),
          internalIp: document.getElementById('vpn-internalIp').value.trim(),
        };
      }
      function readRouter() {
        return {
          type: document.getElementById('router-type').value,
          host: document.getElementById('router-host').value.trim(),
          username: document.getElementById('router-username').value.trim(),
          password: document.getElementById('router-password').value,
          inInterfaceId: document.getElementById('router-inInterfaceId').value.trim(),
          sourceZoneId: document.getElementById('router-sourceZoneId').value.trim(),
          destinationZoneId: document.getElementById('router-destinationZoneId').value.trim(),
        };
      }
      async function postJson(url, method, body) {
        const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, data };
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
        populateSelect('router-inInterfaceId', data.interfaces || [], true);
        populateSelect('router-sourceZoneId', data.zones || [], false);
        populateSelect('router-destinationZoneId', data.zones || [], false);
        show('router-discover-result', 'Loaded ' + (data.interfaces ? data.interfaces.length : 0) + ' interfaces, ' + (data.zones ? data.zones.length : 0) + ' zones.', true);
      }
      function populateSelect(id, items, isInterface) {
        const sel = document.getElementById(id);
        sel.innerHTML = '';
        for (const it of items) {
          const opt = document.createElement('option');
          opt.value = it.id;
          const extra = isInterface
            ? (it.purpose ? ' (' + it.purpose + ')' : '')
            : (it.key ? ' (' + it.key + ')' : '');
          opt.textContent = it.name + extra + ' — ' + it.id;
          sel.appendChild(opt);
        }
      }
      const saved = { vpn: false, router: false };
      function maybeDone() {
        if (saved.vpn && saved.router) {
          document.getElementById('done-box').style.display = 'block';
          localStorage.setItem('restartRequired', '1');
        }
      }
      async function saveVpn() {
        const { ok, data } = await postJson('/api/settings/vpn', 'PUT', readVpn());
        if (ok) { show('vpn-result', 'Saved.', true); saved.vpn = true; maybeDone(); }
        else show('vpn-result', 'Save failed: ' + JSON.stringify(data), false);
      }
      async function testVpn() {
        show('vpn-result', 'Testing…', true);
        const { data } = await postJson('/api/settings/vpn/test', 'POST', readVpn());
        show('vpn-result', data.ok ? 'Connected.' : ('Failed: ' + (data.error ?? 'unknown')), data.ok);
      }
      async function saveRouter() {
        const { ok, data } = await postJson('/api/settings/router', 'PUT', readRouter());
        if (ok) { show('router-result', 'Saved.', true); saved.router = true; maybeDone(); }
        else show('router-result', 'Save failed: ' + JSON.stringify(data), false);
      }
      async function testRouter() {
        show('router-result', 'Testing…', true);
        const { data } = await postJson('/api/settings/router/test', 'POST', readRouter());
        show('router-result', data.ok ? 'Connected.' : ('Failed: ' + (data.error ?? 'unknown')), data.ok);
      }
    </script>
  `;
}
