import type { Hook } from '../db.js';
import { hookPluginDescriptors } from '../hooks/plugins/registry.js';

interface HookSeedConfig {
  [k: string]: string | Record<string, string>;
}

// Convert a stored Hook row into the display-level seed the builder uses.
// When the row has type === "plugin", the display type becomes the inner
// config.plugin value (e.g. "plex") and the "plugin" key is stripped from
// the config so the form doesn't re-emit it as a duplicate input.
// The webhook `headers` field is preserved as a nested object so the
// webhook fields can render one row per header; everything else is
// stringified so the <input value="..."> attributes don't break.
function seedHook(hook: Hook): { type: string; config: HookSeedConfig } {
  let cfg: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(hook.config);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      cfg = parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to empty config
  }

  let displayType = hook.type;
  if (hook.type === 'plugin' && typeof cfg.plugin === 'string') {
    displayType = cfg.plugin;
    delete cfg.plugin;
  }

  const out: HookSeedConfig = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (v === null || v === undefined) continue;
    if (k === 'headers' && typeof v === 'object' && !Array.isArray(v)) {
      const headers: Record<string, string> = {};
      for (const [hk, hv] of Object.entries(v as Record<string, unknown>)) {
        if (hv !== null && hv !== undefined) headers[hk] = String(hv);
      }
      out.headers = headers;
    } else if (typeof v !== 'object') {
      out[k] = String(v);
    }
  }
  return { type: displayType, config: out };
}

// Returns the hook-builder UI: a container, an "+ Add Hook" button, and the
// JS that manages additions, removals, dynamic fields per hook type, and
// inline help text. Pass `existing` to pre-populate rows (the edit form uses
// this).
export function hookBuilder(existing: Hook[] = []): string {
  const seeds = existing.map(seedHook);
  const seedLiteral = JSON.stringify(seeds).replace(/</g, '\\u003c');

  // Server-rendered option list: plugins first, then webhook.
  const typeOptions = [
    ...hookPluginDescriptors.map((d) => ({ id: d.id, label: d.label, description: d.description })),
    {
      id: 'webhook',
      label: 'Webhook',
      description: 'Send the hook payload to any URL. POST/PUT use a JSON body; GET sends the fields as query parameters. 2xx = success.',
    },
  ];
  const typeOptionsLiteral = JSON.stringify(typeOptions).replace(/</g, '\\u003c');
  const pluginDescriptorsLiteral = JSON.stringify(hookPluginDescriptors).replace(
    /</g,
    '\\u003c'
  );

  return `
    <div class="section-title">Hooks (optional)</div>
    <div id="hooks-container"></div>
    <button type="button" class="btn secondary" id="add-hook-btn" style="margin-bottom:20px;">+ Add Hook</button>
    <script>
      (function () {
        var container = document.getElementById('hooks-container');
        var addBtn = document.getElementById('add-hook-btn');
        var hookIndex = 0;

        var TYPE_OPTIONS = ${typeOptionsLiteral};
        var PLUGIN_DESCRIPTORS = ${pluginDescriptorsLiteral};
        var PLUGIN_IDS = PLUGIN_DESCRIPTORS.map(function (d) { return d.id; });

        function esc(s) {
          return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function descriptionFor(type) {
          var match = TYPE_OPTIONS.filter(function (t) { return t.id === type; })[0];
          return match ? match.description : '';
        }

        function pluginDescriptor(id) {
          return PLUGIN_DESCRIPTORS.filter(function (d) { return d.id === id; })[0] || null;
        }

        function fieldHtml(n, field, value) {
          var inputType = field.type === 'password' ? 'password' : 'text';
          var req = field.required ? ' required' : '';
          var ph = field.placeholder ? ' placeholder="' + esc(field.placeholder) + '"' : '';
          return '<div class="form-group">' +
              '<label>' + esc(field.label) + '</label>' +
              '<input type="' + inputType + '" name="hooks[' + n + '][' + esc(field.name) + ']"' +
                ' value="' + esc(value) + '"' + ph + req + ' autocomplete="off" />' +
              (field.help ? '<div class="form-help">' + esc(field.help) + '</div>' : '') +
            '</div>';
        }

        function pluginFields(n, descriptor, cfg) {
          cfg = cfg || {};
          return descriptor.fields.map(function (f) {
            return fieldHtml(n, f, cfg[f.name]);
          }).join('');
        }

        function headerRowHtml(n, i, name, value) {
          return '<div class="webhook-header-row" data-idx="' + i + '" style="display:flex;gap:8px;margin-bottom:6px;">' +
              '<input type="text" name="hooks[' + n + '][headers][' + i + '][name]"' +
                ' value="' + esc(name) + '" placeholder="Header name (e.g. Authorization)" style="flex:1;" />' +
              '<input type="text" name="hooks[' + n + '][headers][' + i + '][value]"' +
                ' value="' + esc(value) + '" placeholder="Value" style="flex:1;" />' +
              '<button type="button" class="btn secondary webhook-header-remove" tabindex="-1">Remove</button>' +
            '</div>';
        }

        function webhookFields(n, cfg) {
          cfg = cfg || {};
          var methods = ['POST', 'GET', 'PUT'];
          var current = cfg.method || 'POST';
          var methodOpts = methods.map(function (m) {
            var sel = m === current ? ' selected' : '';
            return '<option value="' + m + '"' + sel + '>' + m + '</option>';
          }).join('');

          var headerPairs = [];
          var rawHeaders = cfg.headers;
          if (rawHeaders && typeof rawHeaders === 'object') {
            for (var k in rawHeaders) {
              if (Object.prototype.hasOwnProperty.call(rawHeaders, k)) {
                headerPairs.push([k, String(rawHeaders[k])]);
              }
            }
          }
          var headerRowsHtml = headerPairs.map(function (p, i) {
            return headerRowHtml(n, i, p[0], p[1]);
          }).join('');

          return '<div class="form-group">' +
              '<label>Webhook URL</label>' +
              '<input type="text" class="webhook-url" name="hooks[' + n + '][url]" required value="' + esc(cfg.url) + '" placeholder="https://..." />' +
              '<div class="form-help">POST/PUT send the payload as a JSON body. GET appends the payload fields as query parameters. Any 2xx response counts as success.</div>' +
            '</div>' +
            '<div class="form-group">' +
              '<label>Method</label>' +
              '<select class="webhook-method" name="hooks[' + n + '][method]">' + methodOpts + '</select>' +
            '</div>' +
            '<div class="form-group">' +
              '<label>Custom headers</label>' +
              '<div class="webhook-headers" data-next-idx="' + headerPairs.length + '">' + headerRowsHtml + '</div>' +
              '<button type="button" class="btn secondary webhook-header-add" style="margin-top:4px;">+ Add header</button>' +
              '<div class="form-help">For POST/PUT, Content-Type: application/json is added automatically. Custom headers override it if you set one with the same name.</div>' +
            '</div>' +
            '<div class="form-group">' +
              '<label>Example request</label>' +
              '<pre class="webhook-example" style="background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:10px;font-size:12px;white-space:pre-wrap;word-break:break-all;margin:0;"></pre>' +
              '<div class="form-help">Preview of the outgoing request using a sample payload.</div>' +
            '</div>';
        }

        var SAMPLE_PAYLOAD = {
          mappingId: '7b3c9e2a-...',
          label: 'Plex',
          oldPort: 58216,
          newPort: 59000,
          destIp: '10.0.17.249',
          destPort: 32400,
          externalIp: '203.0.113.42'
        };

        function collectWebhookHeaders(wrapper) {
          var rows = wrapper.querySelectorAll('.webhook-header-row');
          var out = [];
          rows.forEach(function (row) {
            var inputs = row.querySelectorAll('input');
            var name = inputs[0] ? inputs[0].value.trim() : '';
            var value = inputs[1] ? inputs[1].value : '';
            if (name) out.push([name, value]);
          });
          return out;
        }

        function renderWebhookExample(wrapper) {
          var pre = wrapper.querySelector('.webhook-example');
          if (!pre) return;
          var urlEl = wrapper.querySelector('.webhook-url');
          var methodEl = wrapper.querySelector('.webhook-method');
          var url = urlEl && urlEl.value ? urlEl.value : 'https://example.com/hook';
          var method = (methodEl && methodEl.value ? methodEl.value : 'POST').toUpperCase();
          var isGet = method === 'GET';

          var path = '/';
          var host = '';
          var parsedOk = false;
          var parsedUrl = null;
          try {
            parsedUrl = new URL(url);
            parsedOk = true;
            host = parsedUrl.host;
          } catch (e) { /* ignore — show raw url below */ }

          if (isGet) {
            if (parsedOk) {
              Object.keys(SAMPLE_PAYLOAD).forEach(function (k) {
                var v = SAMPLE_PAYLOAD[k];
                if (v === null || v === undefined) return;
                parsedUrl.searchParams.set(k, String(v));
              });
              path = parsedUrl.pathname + parsedUrl.search;
            } else {
              path = url;
            }
          } else if (parsedOk) {
            path = parsedUrl.pathname + parsedUrl.search;
          } else {
            path = url;
          }

          var headers = [];
          if (!isGet) headers.push(['Content-Type', 'application/json']);
          collectWebhookHeaders(wrapper).forEach(function (p) { headers.push(p); });

          var lines = [];
          lines.push(method + ' ' + path + ' HTTP/1.1');
          if (host) lines.push('Host: ' + host);
          headers.forEach(function (h) { lines.push(h[0] + ': ' + h[1]); });
          if (!isGet) {
            lines.push('');
            lines.push(JSON.stringify(SAMPLE_PAYLOAD, null, 2));
          }
          pre.textContent = lines.join('\\n');
        }

        function bindWebhookControls(wrapper, n) {
          var fieldsDiv = wrapper.querySelector('.hook-dynamic-fields');
          var container = wrapper.querySelector('.webhook-headers');
          var addBtn = wrapper.querySelector('.webhook-header-add');
          if (!fieldsDiv || !container || !addBtn) return;

          // Listeners live on the fields div, which is replaced whenever the
          // hook type changes — so they don't accumulate across switches.
          fieldsDiv.addEventListener('input', function () {
            renderWebhookExample(wrapper);
          });
          fieldsDiv.addEventListener('change', function () {
            renderWebhookExample(wrapper);
          });

          addBtn.addEventListener('click', function () {
            var next = parseInt(container.getAttribute('data-next-idx') || '0', 10);
            container.insertAdjacentHTML('beforeend', headerRowHtml(n, next, '', ''));
            container.setAttribute('data-next-idx', String(next + 1));
            renderWebhookExample(wrapper);
          });

          container.addEventListener('click', function (ev) {
            var btn = ev.target.closest && ev.target.closest('.webhook-header-remove');
            if (!btn) return;
            var row = btn.closest('.webhook-header-row');
            if (row) row.remove();
            renderWebhookExample(wrapper);
          });

          renderWebhookExample(wrapper);
        }

        function renderFields(wrapper, n, type, cfg) {
          var fieldsDiv = wrapper.querySelector('.hook-dynamic-fields');
          var helpDiv = wrapper.querySelector('.hook-type-help');
          if (helpDiv) helpDiv.textContent = descriptionFor(type);

          if (type === 'webhook') {
            fieldsDiv.innerHTML = webhookFields(n, cfg);
            bindWebhookControls(wrapper, n);
            return;
          }
          var desc = pluginDescriptor(type);
          if (desc) { fieldsDiv.innerHTML = pluginFields(n, desc, cfg); return; }
          fieldsDiv.innerHTML = '';
        }

        function addHook(seed) {
          var n = hookIndex++;
          var defaultType = TYPE_OPTIONS.length > 0 ? TYPE_OPTIONS[0].id : 'webhook';
          var initialType = (seed && seed.type) || defaultType;
          var initialCfg = (seed && seed.config) || {};

          var typeOpts = TYPE_OPTIONS.map(function (t) {
            var sel = t.id === initialType ? ' selected' : '';
            return '<option value="' + esc(t.id) + '"' + sel + '>' + esc(t.label) + '</option>';
          }).join('');

          var wrapper = document.createElement('div');
          wrapper.className = 'hook-builder-item';
          wrapper.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
              '<label style="margin:0;">Hook ' + (n + 1) + '</label>' +
              '<button type="button" class="hook-remove-btn">Remove</button>' +
            '</div>' +
            '<div class="form-group">' +
              '<label>Type</label>' +
              '<select name="hooks[' + n + '][type]" class="hook-type-select">' + typeOpts + '</select>' +
              '<div class="form-help hook-type-help"></div>' +
            '</div>' +
            '<div class="hook-dynamic-fields"></div>';

          wrapper.querySelector('.hook-remove-btn').addEventListener('click', function () {
            wrapper.remove();
          });

          var typeSelect = wrapper.querySelector('.hook-type-select');
          typeSelect.addEventListener('change', function () {
            renderFields(wrapper, n, typeSelect.value, {});
          });

          container.appendChild(wrapper);
          renderFields(wrapper, n, initialType, initialCfg);
        }

        addBtn.addEventListener('click', function () { addHook(); });

        var seeds = ${seedLiteral};
        seeds.forEach(function (s) { addHook(s); });
      })();
    </script>`;
}

// Parses the form body produced by hookBuilder() into an array of
// { type, config } entries (config as a JSON string ready for DB).
// Display-level plugin types (e.g. "plex") are translated to the storage
// shape the runner expects: type: "plugin", config.plugin: "<id>".
// Webhook custom headers arrive as `hooks[N][headers][i][name|value]`
// pairs and are collected into a single `headers: Record<string,string>`
// object on the config.
export function parseHookForm(
  body: Record<string, unknown>
): { type: string; config: string }[] {
  const grouped: Record<number, Record<string, string>> = {};
  const headerGroups: Record<number, Record<number, { name?: string; value?: string }>> = {};

  for (const [key, value] of Object.entries(body)) {
    const headerMatch = key.match(/^hooks\[(\d+)\]\[headers\]\[(\d+)\]\[(name|value)\]$/);
    if (headerMatch) {
      const idx = parseInt(headerMatch[1], 10);
      const hIdx = parseInt(headerMatch[2], 10);
      const field = headerMatch[3] as 'name' | 'value';
      if (!headerGroups[idx]) headerGroups[idx] = {};
      if (!headerGroups[idx][hIdx]) headerGroups[idx][hIdx] = {};
      const raw = String(value ?? '');
      headerGroups[idx][hIdx][field] = field === 'name' ? raw.trim() : raw;
      continue;
    }
    const match = key.match(/^hooks\[(\d+)\]\[(\w+)\]$/);
    if (!match) continue;
    const idx = parseInt(match[1], 10);
    const field = match[2];
    if (!grouped[idx]) grouped[idx] = {};
    grouped[idx][field] = String(value ?? '').trim();
  }

  const pluginIds = new Set(hookPluginDescriptors.map((d) => d.id));

  const allIndices = new Set<number>([
    ...Object.keys(grouped).map(Number),
    ...Object.keys(headerGroups).map(Number),
  ]);

  const result: { type: string; config: string }[] = [];
  for (const idx of allIndices) {
    const group = grouped[idx] ?? {};
    const { type, ...rest } = group;
    if (!type) continue;
    const nonEmpty: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== '') nonEmpty[k] = v;
    }
    const hgroup = headerGroups[idx];
    if (hgroup) {
      const headers: Record<string, string> = {};
      for (const row of Object.values(hgroup)) {
        if (row.name) headers[row.name] = row.value ?? '';
      }
      if (Object.keys(headers).length > 0) nonEmpty.headers = headers;
    }
    if (pluginIds.has(type)) {
      result.push({
        type: 'plugin',
        config: JSON.stringify({ plugin: type, ...nonEmpty }),
      });
    } else {
      result.push({ type, config: JSON.stringify(nonEmpty) });
    }
  }
  return result;
}
