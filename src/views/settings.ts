import type {
  AppSettings,
  NotificationsSettings,
  RouterSettings,
  VpnSettings,
} from "../settings.js";
import { escHtml } from "./layout.js";
import { providerDefinitions } from "../providers/registry.js";
import { routerDefinitions } from "../routers/registry.js";
import { notifierDefinitions } from "../notifications/registry.js";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
} from "../notifications/types.js";

interface SettingsViewProps {
  vpn: VpnSettings | null;
  router: RouterSettings | null;
  app: AppSettings;
  notifications: NotificationsSettings;
  issues?: string[];
}

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  "port.renewed": "Port renewed",
  "port.expired": "Port expired",
  "port.recreated": "Port recreated (sync)",
  "port.recreate_failed": "Port recreate failed",
  "router.repair_failed": "Router rule repair failed",
  "provider.login_failed": "Router login failed",
  "mapping.create_failed": "Mapping create failed (router)",
  "mapping.update_failed": "Mapping update failed (router)",
  "mapping.delete_failed": "Mapping delete had errors",
  "ip.changed": "Public IP changed",
};

export function settingsView(props: SettingsViewProps): string {
  const vpnProviderId = props.vpn?.provider ?? providerDefinitions[0].id;
  const routerTypeId = props.router?.type ?? routerDefinitions[0].id;
  const notifierId =
    (props.notifications.notifier as { provider?: string } | null)?.provider ??
    notifierDefinitions[0].id;

  const app = props.app;
  const maxPorts = app.maxPorts ?? "";
  const syncIntervalMinutes = app.syncIntervalMinutes;
  const renewDays = app.renewThresholdDays;

  const notifications = props.notifications;

  function isCategoryOn(cat: NotificationCategory): boolean {
    const val = notifications.categories[cat];
    return val === undefined ? true : val;
  }

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
      Changes take effect immediately. If a live reload fails, a yellow banner
      will ask you to restart the container.
    </div>

    <h2 class="section-title">VPN provider</h2>
    <form id="vpn-form" class="card" style="margin-bottom:24px;">
      <div class="form-group">
        <label for="vpn-provider">Provider</label>
        <select id="vpn-provider" onchange="onVpnProviderChange()">
          ${providerDefinitions
            .map(
              (d) =>
                `<option value="${escHtml(d.id)}"${d.id === vpnProviderId ? " selected" : ""}>${escHtml(d.label)}</option>`
            )
            .join("")}
        </select>
      </div>
      ${providerDefinitions
        .map(
          (d) =>
            `<div class="provider-fields" data-provider-id="${escHtml(d.id)}"${d.id === vpnProviderId ? "" : " style=\"display:none;\""}>
               ${d.renderFields(props.vpn && props.vpn.provider === d.id ? props.vpn : null)}
             </div>`
        )
        .join("")}
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
        <select id="router-type" onchange="onRouterTypeChange()">
          ${routerDefinitions
            .map(
              (d) =>
                `<option value="${escHtml(d.id)}"${d.id === routerTypeId ? " selected" : ""}>${escHtml(d.label)}</option>`
            )
            .join("")}
        </select>
      </div>
      ${routerDefinitions
        .map(
          (d) =>
            `<div class="router-fields" data-router-id="${escHtml(d.id)}"${d.id === routerTypeId ? "" : " style=\"display:none;\""}>
               ${d.renderFields(props.router && props.router.type === d.id ? props.router : null)}
             </div>`
        )
        .join("")}
      <div class="form-actions">
        <button type="button" class="btn primary" onclick="saveRouter()">Save</button>
        <button type="button" class="btn secondary" onclick="testRouter()">Test</button>
        <span id="router-result" class="muted"></span>
      </div>
    </form>

    <h2 class="section-title">App</h2>
    <form id="app-form" class="card" style="margin-bottom:24px;">
      <div class="form-group">
        <label for="app-maxPorts">Max ports (blank = provider default)</label>
        <input id="app-maxPorts" name="maxPorts" type="number" min="1" value="${escHtml(String(maxPorts))}" />
      </div>
      <div class="form-group">
        <label for="app-syncIntervalMinutes">Sync interval (minutes)</label>
        <input id="app-syncIntervalMinutes" name="syncIntervalMinutes" type="number" min="1" value="${escHtml(syncIntervalMinutes)}" />
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

    <h2 class="section-title">Notifications</h2>
    <form id="notify-form" class="card">
      <div class="form-group">
        <label>
          <input id="notify-enabled" type="checkbox"${notifications.enabled ? " checked" : ""} />
          Enable notifications
        </label>
      </div>
      <div class="form-group">
        <label for="notify-provider">Backend</label>
        <select id="notify-provider" onchange="onNotifyProviderChange()">
          ${notifierDefinitions
            .map(
              (d) =>
                `<option value="${escHtml(d.id)}"${d.id === notifierId ? " selected" : ""}>${escHtml(d.label)}</option>`
            )
            .join("")}
        </select>
      </div>
      ${notifierDefinitions
        .map((d) => {
          const stored =
            notifications.notifier &&
            (notifications.notifier as { provider?: string }).provider === d.id
              ? (notifications.notifier as never)
              : null;
          return `<div class="notifier-fields" data-notifier-id="${escHtml(d.id)}"${d.id === notifierId ? "" : " style=\"display:none;\""}>
                    ${d.renderFields(stored)}
                  </div>`;
        })
        .join("")}

      <h3 class="section-title" style="font-size:1em;margin-top:16px;">Events to notify on</h3>
      <div class="form-group">
        ${NOTIFICATION_CATEGORIES
          .map(
            (cat) =>
              `<label style="display:block;margin:4px 0;">
                 <input type="checkbox" class="notify-category" data-category="${escHtml(cat)}"${isCategoryOn(cat) ? " checked" : ""} />
                 ${escHtml(CATEGORY_LABELS[cat])}
               </label>`
          )
          .join("")}
      </div>

      <div class="form-actions">
        <button type="button" class="btn primary" onclick="saveNotifications()">Save</button>
        <button type="button" class="btn secondary" onclick="testNotifications()">Test</button>
        <span id="notify-result" class="muted"></span>
      </div>
    </form>

    <script>
      ${providerDefinitions.map((d) => d.readerScript).join("\n")}
      ${routerDefinitions.map((d) => d.readerScript).join("\n")}
      ${notifierDefinitions.map((d) => d.readerScript).join("\n")}
      ${dispatchScript(props)}
    </script>
  `;
}

function dispatchScript(props: SettingsViewProps): string {
  const vpnConfigured = props.vpn !== null;
  const routerConfigured = props.router !== null;
  const notifierConfigured = props.notifications.notifier !== null;

  const vpnDispatch = providerDefinitions
    .map((d) => `if (id === '${d.id}') return ${d.readerName}(opts);`)
    .join("\n    ");
  const routerDispatch = routerDefinitions
    .map((d) => `if (id === '${d.id}') return ${d.readerName}(opts);`)
    .join("\n    ");
  const notifyDispatch = notifierDefinitions
    .map((d) => `if (id === '${d.id}') return ${d.readerName}(opts);`)
    .join("\n    ");

  return `
    function show(id, msg, ok) {
      const el = document.getElementById(id);
      el.textContent = msg;
      el.style.color = ok ? '#3fb950' : '#f85149';
    }
    function handleSaveResult(data) {
      if (data && data.restartRequired) {
        localStorage.setItem('restartRequired', '1');
        if (data.reloadError) {
          localStorage.setItem('reloadError', String(data.reloadError));
        } else {
          localStorage.removeItem('reloadError');
        }
        var banner = document.getElementById('restart-banner');
        var msg = document.getElementById('restart-banner-msg');
        if (data.reloadError && msg) {
          msg.innerHTML = '<strong>Live reload failed:</strong> ' +
            String(data.reloadError).replace(/</g, '&lt;') +
            '. Restart the container to apply the new settings.';
        }
        if (banner) banner.classList.add('show');
      } else {
        localStorage.removeItem('restartRequired');
        localStorage.removeItem('reloadError');
        var b = document.getElementById('restart-banner');
        if (b) b.classList.remove('show');
      }
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
    function onNotifyProviderChange() {
      const id = document.getElementById('notify-provider').value;
      document.querySelectorAll('.notifier-fields').forEach((el) => {
        el.style.display = el.dataset.notifierId === id ? '' : 'none';
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
    function readNotifier(opts) {
      const id = document.getElementById('notify-provider').value;
      ${notifyDispatch}
      throw new Error('Unknown notifier: ' + id);
    }
    function readNotificationCategories() {
      const out = {};
      document.querySelectorAll('.notify-category').forEach(function (el) {
        out[el.dataset.category] = el.checked;
      });
      return out;
    }
    async function postJson(url, method, body) {
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    }
    async function saveVpn() {
      try {
        const body = readVpn({ requireSecret: ${!vpnConfigured} });
        const { ok, data } = await postJson('/api/settings/vpn', 'PUT', body);
        if (ok) {
          show('vpn-result', data && data.reloadError ? 'Saved — restart required.' : 'Saved.', true);
          handleSaveResult(data);
        } else show('vpn-result', 'Save failed: ' + JSON.stringify(data), false);
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
        const body = readRouter({ requireSecret: ${!routerConfigured} });
        const { ok, data } = await postJson('/api/settings/router', 'PUT', body);
        if (ok) {
          show('router-result', data && data.reloadError ? 'Saved — restart required.' : 'Saved.', true);
          handleSaveResult(data);
        } else show('router-result', 'Save failed: ' + JSON.stringify(data), false);
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
    async function saveApp() {
      const maxPortsStr = document.getElementById('app-maxPorts').value.trim();
      const body = {
        maxPorts: maxPortsStr === '' ? null : Number(maxPortsStr),
        syncIntervalMinutes: Number(document.getElementById('app-syncIntervalMinutes').value),
        renewThresholdDays: Number(document.getElementById('app-renewDays').value),
      };
      const { ok, data } = await postJson('/api/settings/app', 'PUT', body);
      if (ok) {
        show('app-result', data && data.reloadError ? 'Saved — restart required.' : 'Saved.', true);
        handleSaveResult(data);
      } else show('app-result', 'Save failed: ' + JSON.stringify(data), false);
    }
    function buildNotificationsBody(requireSecret) {
      const enabled = document.getElementById('notify-enabled').checked;
      let notifier = null;
      try {
        notifier = readNotifier({ requireSecret: requireSecret });
      } catch (e) {
        if (enabled) throw e;
      }
      return {
        enabled: enabled,
        notifier: notifier,
        categories: readNotificationCategories(),
      };
    }
    async function saveNotifications() {
      try {
        const body = buildNotificationsBody(${!notifierConfigured});
        const { ok, data } = await postJson('/api/settings/notifications', 'PUT', body);
        if (ok) {
          show('notify-result', data && data.reloadError ? 'Saved — restart required.' : 'Saved.', true);
          handleSaveResult(data);
        } else show('notify-result', 'Save failed: ' + JSON.stringify(data), false);
      } catch (e) { show('notify-result', e.message, false); }
    }
    async function testNotifications() {
      try {
        const notifier = readNotifier({ requireSecret: true });
        show('notify-result', 'Sending test…', true);
        const { data } = await postJson('/api/settings/notifications/test', 'POST', { notifier: notifier });
        show('notify-result', data.ok ? 'Test sent.' : ('Failed: ' + (data.error ?? 'unknown')), data.ok);
      } catch (e) { show('notify-result', e.message, false); }
    }
  `;
}
