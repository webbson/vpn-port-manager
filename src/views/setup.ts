import { escHtml } from "./layout.js";
import { providerDefinitions } from "../providers/registry.js";
import { routerDefinitions } from "../routers/registry.js";

export function setupView(props: { issues?: string[] } = {}): string {
  const issues = props.issues ?? [];
  const staleBanner = issues.length
    ? `<div class="info-box" style="border-color:#d2992255;background:#3d2f05;color:#d29922;">
         <strong>Previously-saved settings need re-entry.</strong>
         <ul style="margin:8px 0 0 18px;">${issues.map((m) => `<li>${escHtml(m)}</li>`).join("")}</ul>
       </div>`
    : "";

  const firstProviderId = providerDefinitions[0].id;
  const firstRouterId = routerDefinitions[0].id;

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
        <select id="vpn-provider" onchange="onVpnProviderChange()">
          ${providerDefinitions
            .map(
              (d) =>
                `<option value="${escHtml(d.id)}"${d.id === firstProviderId ? " selected" : ""}>${escHtml(d.label)}</option>`
            )
            .join("")}
        </select>
      </div>
      ${providerDefinitions
        .map(
          (d) =>
            `<div class="provider-fields" data-provider-id="${escHtml(d.id)}"${d.id === firstProviderId ? "" : " style=\"display:none;\""}>
               ${d.renderFields(null)}
             </div>`
        )
        .join("")}
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
        <select id="router-type" onchange="onRouterTypeChange()">
          ${routerDefinitions
            .map(
              (d) =>
                `<option value="${escHtml(d.id)}"${d.id === firstRouterId ? " selected" : ""}>${escHtml(d.label)}</option>`
            )
            .join("")}
        </select>
      </div>
      ${routerDefinitions
        .map(
          (d) =>
            `<div class="router-fields" data-router-id="${escHtml(d.id)}"${d.id === firstRouterId ? "" : " style=\"display:none;\""}>
               ${d.renderFields(null)}
             </div>`
        )
        .join("")}
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
      ${providerDefinitions.map((d) => d.readerScript).join("\n")}
      ${routerDefinitions.map((d) => d.readerScript).join("\n")}
      ${setupDispatchScript()}
    </script>
  `;
}

function setupDispatchScript(): string {
  const vpnDispatch = providerDefinitions
    .map((d) => `if (id === '${d.id}') return ${d.readerName}(opts);`)
    .join("\n    ");
  const routerDispatch = routerDefinitions
    .map((d) => `if (id === '${d.id}') return ${d.readerName}(opts);`)
    .join("\n    ");

  return `
    function show(id, msg, ok) {
      const el = document.getElementById(id); el.textContent = msg;
      el.style.color = ok ? '#3fb950' : '#f85149';
    }
    function onVpnProviderChange() {
      const id = document.getElementById('vpn-provider').value;
      document.querySelectorAll('.provider-fields').forEach((el) => {
        el.style.display = el.dataset.providerId === id ? '' : 'none';
      });
    }
    function onRouterTypeChange() {
      const id = document.getElementById('router-type').value;
      document.querySelectorAll('.router-fields').forEach((el) => {
        el.style.display = el.dataset.routerId === id ? '' : 'none';
      });
    }
    function readVpn(opts) {
      const id = document.getElementById('vpn-provider').value;
      ${vpnDispatch}
      throw new Error('Unknown provider: ' + id);
    }
    function readRouter(opts) {
      const id = document.getElementById('router-type').value;
      ${routerDispatch}
      throw new Error('Unknown router type: ' + id);
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
      try {
        const body = readVpn({ requireSecret: true });
        const { ok, data } = await postJson('/api/settings/vpn', 'PUT', body);
        if (ok) { show('vpn-result', 'Saved.', true); saved.vpn = true; maybeDone(); }
        else show('vpn-result', 'Save failed: ' + JSON.stringify(data), false);
      } catch (e) { show('vpn-result', e.message, false); }
    }
    async function testVpn() {
      try {
        const body = readVpn({ requireSecret: true });
        show('vpn-result', 'Testing…', true);
        const { data } = await postJson('/api/settings/vpn/test', 'POST', body);
        show('vpn-result', data.ok ? 'Connected.' : ('Failed: ' + (data.error ?? 'unknown')), data.ok);
      } catch (e) { show('vpn-result', e.message, false); }
    }
    async function saveRouter() {
      try {
        const body = readRouter({ requireSecret: true });
        const { ok, data } = await postJson('/api/settings/router', 'PUT', body);
        if (ok) { show('router-result', 'Saved.', true); saved.router = true; maybeDone(); }
        else show('router-result', 'Save failed: ' + JSON.stringify(data), false);
      } catch (e) { show('router-result', e.message, false); }
    }
    async function testRouter() {
      try {
        const body = readRouter({ requireSecret: true });
        show('router-result', 'Testing…', true);
        const { data } = await postJson('/api/settings/router/test', 'POST', body);
        show('router-result', data.ok ? 'Connected.' : ('Failed: ' + (data.error ?? 'unknown')), data.ok);
      } catch (e) { show('router-result', e.message, false); }
    }
  `;
}
