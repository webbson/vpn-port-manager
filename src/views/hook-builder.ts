import type { Hook } from '../db.js';
import { hookPluginDescriptors } from '../hooks/plugins/registry.js';

interface HookSeed {
  type: string;
  config: Record<string, string>;
}

// Convert a stored Hook row into the display-level seed the builder uses.
// When the row has type === "plugin", the display type becomes the inner
// config.plugin value (e.g. "plex") and the "plugin" key is stripped from
// the config so the form doesn't re-emit it as a duplicate input.
function seedHook(hook: Hook): HookSeed {
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

  const stringified: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (v !== null && v !== undefined) stringified[k] = String(v);
  }
  return { type: displayType, config: stringified };
}

// Returns the hook-builder UI: a container, an "+ Add Hook" button, and the
// JS that manages additions, removals, dynamic fields per hook type, and
// inline help text. Pass `existing` to pre-populate rows (the edit form uses
// this).
export function hookBuilder(existing: Hook[] = []): string {
  const seeds = existing.map(seedHook);
  const seedLiteral = JSON.stringify(seeds).replace(/</g, '\\u003c');

  // Server-rendered option list: plugins first, then webhook & command.
  const typeOptions = [
    ...hookPluginDescriptors.map((d) => ({ id: d.id, label: d.label, description: d.description })),
    {
      id: 'webhook',
      label: 'Webhook',
      description: 'POST the hook payload as JSON to any URL (2xx = success).',
    },
    {
      id: 'command',
      label: 'Command',
      description:
        'Run a shell command. Use {{label}}, {{oldPort}}, {{newPort}}, {{destIp}}, {{destPort}}, {{mappingId}} as placeholders.',
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

        function webhookFields(n, cfg) {
          cfg = cfg || {};
          var methods = ['POST', 'GET', 'PUT'];
          var current = cfg.method || 'POST';
          var methodOpts = methods.map(function (m) {
            var sel = m === current ? ' selected' : '';
            return '<option value="' + m + '"' + sel + '>' + m + '</option>';
          }).join('');
          return '<div class="form-group">' +
              '<label>Webhook URL</label>' +
              '<input type="text" name="hooks[' + n + '][url]" required value="' + esc(cfg.url) + '" placeholder="https://..." />' +
              '<div class="form-help">The full hook payload is POSTed as JSON. Any 2xx response is treated as success.</div>' +
            '</div>' +
            '<div class="form-group">' +
              '<label>Method</label>' +
              '<select name="hooks[' + n + '][method]">' + methodOpts + '</select>' +
            '</div>';
        }

        function commandFields(n, cfg) {
          cfg = cfg || {};
          return '<div class="form-group">' +
              '<label>Command</label>' +
              '<input type="text" name="hooks[' + n + '][command]" required value="' + esc(cfg.command) +
                '" placeholder="e.g. /usr/local/bin/notify.sh {{label}} {{newPort}}" />' +
              '<div class="form-help">Runs via sh -c inside the container (30s timeout). ' +
                'Placeholders: {{label}}, {{oldPort}}, {{newPort}}, {{destIp}}, {{destPort}}, {{mappingId}}.</div>' +
            '</div>';
        }

        function renderFields(wrapper, n, type, cfg) {
          var fieldsDiv = wrapper.querySelector('.hook-dynamic-fields');
          var helpDiv = wrapper.querySelector('.hook-type-help');
          if (helpDiv) helpDiv.textContent = descriptionFor(type);

          if (type === 'webhook') { fieldsDiv.innerHTML = webhookFields(n, cfg); return; }
          if (type === 'command') { fieldsDiv.innerHTML = commandFields(n, cfg); return; }
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
export function parseHookForm(
  body: Record<string, unknown>
): { type: string; config: string }[] {
  const grouped: Record<number, Record<string, string>> = {};
  for (const [key, value] of Object.entries(body)) {
    const match = key.match(/^hooks\[(\d+)\]\[(\w+)\]$/);
    if (!match) continue;
    const idx = parseInt(match[1], 10);
    const field = match[2];
    if (!grouped[idx]) grouped[idx] = {};
    grouped[idx][field] = String(value ?? '').trim();
  }

  const pluginIds = new Set(hookPluginDescriptors.map((d) => d.id));

  const result: { type: string; config: string }[] = [];
  for (const group of Object.values(grouped)) {
    const { type, ...rest } = group;
    if (!type) continue;
    const nonEmpty: Record<string, string> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== '') nonEmpty[k] = v;
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
