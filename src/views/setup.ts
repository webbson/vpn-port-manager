export function setupView(): string {
  return `
    <div class="page-header">
      <h1>Set up VPN Port Manager</h1>
    </div>

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
      <div class="form-group">
        <label for="router-vpnInterface">VPN interface</label>
        <input id="router-vpnInterface" name="vpnInterface" type="text" value="wg0" />
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
          vpnInterface: document.getElementById('router-vpnInterface').value.trim(),
        };
      }
      async function postJson(url, method, body) {
        const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, data };
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
