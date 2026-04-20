import type { Hook } from '../db.js';

interface HookSeed {
  type: string;
  config: Record<string, string>;
}

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
  const stringified: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (v !== null && v !== undefined) stringified[k] = String(v);
  }
  return { type: hook.type, config: stringified };
}

// Returns the hook-builder UI: a container, an "+ Add Hook" button, and the
// JS that manages additions, removals, and dynamic fields per hook type.
// Pass `existing` to pre-populate rows (the edit form uses this).
export function hookBuilder(existing: Hook[] = []): string {
  const seeds = existing.map(seedHook);
  // JSON.stringify output is safe to drop directly into a <script> tag
  // because it escapes `<` sequences adequately for plain data (no HTML
  // in hook configs). If a hook config ever contains `</script>`, replace
  // `</` with `<\/` here first.
  const seedLiteral = JSON.stringify(seeds).replace(/</g, '\\u003c');

  return `
    <div class="section-title">Hooks (optional)</div>
    <div id="hooks-container"></div>
    <button type="button" class="btn secondary" id="add-hook-btn" style="margin-bottom:20px;">+ Add Hook</button>
    <script>
      (function () {
        var container = document.getElementById('hooks-container');
        var addBtn = document.getElementById('add-hook-btn');
        var hookIndex = 0;

        function esc(s) {
          return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function pluginFields(n, cfg) {
          cfg = cfg || {};
          var plugins = ['plex'];
          var opts = plugins.map(function (p) {
            var sel = cfg.plugin === p ? ' selected' : '';
            return '<option value="' + p + '"' + sel + '>' + p + '</option>';
          }).join('');
          return '<div class="form-group"><label>Plugin</label>' +
            '<select name="hooks[' + n + '][plugin]">' + opts + '</select></div>' +
            '<div class="form-group"><label>Host / URL</label>' +
            '<input type="text" name="hooks[' + n + '][host]" value="' + esc(cfg.host) + '" placeholder="http://plex.lan:32400" /></div>' +
            '<div class="form-group"><label>Token</label>' +
            '<input type="text" name="hooks[' + n + '][token]" value="' + esc(cfg.token) + '" /></div>';
        }

        function webhookFields(n, cfg) {
          cfg = cfg || {};
          var methods = ['POST', 'GET', 'PUT'];
          var current = cfg.method || 'POST';
          var opts = methods.map(function (m) {
            var sel = m === current ? ' selected' : '';
            return '<option value="' + m + '"' + sel + '>' + m + '</option>';
          }).join('');
          return '<div class="form-group"><label>Webhook URL</label>' +
            '<input type="text" name="hooks[' + n + '][url]" required value="' + esc(cfg.url) + '" placeholder="https://..." /></div>' +
            '<div class="form-group"><label>Method</label>' +
            '<select name="hooks[' + n + '][method]">' + opts + '</select></div>';
        }

        function commandFields(n, cfg) {
          cfg = cfg || {};
          return '<div class="form-group"><label>Command</label>' +
            '<input type="text" name="hooks[' + n + '][command]" required value="' + esc(cfg.command) +
            '" placeholder="e.g. /usr/local/bin/notify.sh {{label}} {{newPort}}" /></div>';
        }

        function renderFields(wrapper, n, type, cfg) {
          var fieldsDiv = wrapper.querySelector('.hook-dynamic-fields');
          if (type === 'plugin') fieldsDiv.innerHTML = pluginFields(n, cfg);
          else if (type === 'webhook') fieldsDiv.innerHTML = webhookFields(n, cfg);
          else if (type === 'command') fieldsDiv.innerHTML = commandFields(n, cfg);
          else fieldsDiv.innerHTML = '';
        }

        function addHook(seed) {
          var n = hookIndex++;
          var initialType = (seed && seed.type) || 'plugin';
          var initialCfg = (seed && seed.config) || {};
          var types = ['plugin', 'webhook', 'command'];
          var typeOpts = types.map(function (t) {
            var sel = t === initialType ? ' selected' : '';
            var label = t.charAt(0).toUpperCase() + t.slice(1);
            return '<option value="' + t + '"' + sel + '>' + label + '</option>';
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

  const result: { type: string; config: string }[] = [];
  for (const group of Object.values(grouped)) {
    const { type, ...rest } = group;
    if (!type) continue;
    const nonEmpty: Record<string, string> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== '') nonEmpty[k] = v;
    }
    result.push({ type, config: JSON.stringify(nonEmpty) });
  }
  return result;
}
