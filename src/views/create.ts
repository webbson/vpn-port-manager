import { escHtml } from './layout.js';

export function createView(maxPorts: number, currentCount: number): string {
  const remaining = maxPorts - currentCount;

  if (remaining <= 0) {
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

  return `
    <div class="page-header">
      <h1>New Port Mapping</h1>
    </div>

    <div class="info-box">
      <strong>${escHtml(remaining)}</strong> slot${remaining === 1 ? '' : 's'} remaining
      (${escHtml(currentCount)} / ${escHtml(maxPorts)} used)
    </div>

    <div class="card">
      <form method="POST" action="/create">
        <div class="form-group">
          <label for="label">Label</label>
          <input type="text" id="label" name="label" required placeholder="e.g. Home Server SSH" />
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

        <div class="section-title">Hooks (optional)</div>

        <div id="hooks-container"></div>

        <button type="button" class="btn secondary" id="add-hook-btn"
                style="margin-bottom:20px;">+ Add Hook</button>

        <div class="form-actions">
          <button type="submit" class="btn primary">Create Mapping</button>
          <a href="/" class="btn secondary">Cancel</a>
        </div>
      </form>
    </div>

    <script>
      (function () {
        var container = document.getElementById('hooks-container');
        var addBtn = document.getElementById('add-hook-btn');
        var hookIndex = 0;

        function pluginFields(n) {
          return '<div class="form-group"><label>Plugin</label>' +
            '<select name="hooks[' + n + '][plugin]">' +
            '<option value="ntfy">ntfy</option>' +
            '<option value="slack">Slack</option>' +
            '<option value="discord">Discord</option>' +
            '</select></div>' +
            '<div class="form-group"><label>Host / URL</label>' +
            '<input type="text" name="hooks[' + n + '][host]" placeholder="https://ntfy.sh/topic" /></div>' +
            '<div class="form-group"><label>Token (optional)</label>' +
            '<input type="text" name="hooks[' + n + '][token]" /></div>';
        }

        function webhookFields(n) {
          return '<div class="form-group"><label>Webhook URL</label>' +
            '<input type="text" name="hooks[' + n + '][url]" required placeholder="https://..." /></div>' +
            '<div class="form-group"><label>Method</label>' +
            '<select name="hooks[' + n + '][method]">' +
            '<option value="POST">POST</option>' +
            '<option value="GET">GET</option>' +
            '<option value="PUT">PUT</option>' +
            '</select></div>';
        }

        function commandFields(n) {
          return '<div class="form-group"><label>Command</label>' +
            '<input type="text" name="hooks[' + n + '][command]" required placeholder="e.g. /usr/local/bin/notify.sh" /></div>';
        }

        function renderHookFields(wrapper, n, type) {
          var fieldsDiv = wrapper.querySelector('.hook-dynamic-fields');
          if (type === 'plugin') fieldsDiv.innerHTML = pluginFields(n);
          else if (type === 'webhook') fieldsDiv.innerHTML = webhookFields(n);
          else if (type === 'command') fieldsDiv.innerHTML = commandFields(n);
          else fieldsDiv.innerHTML = '';
        }

        function addHook() {
          var n = hookIndex++;
          var wrapper = document.createElement('div');
          wrapper.className = 'hook-builder-item';
          wrapper.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
              '<label style="margin:0;">Hook ' + (n + 1) + '</label>' +
              '<button type="button" class="hook-remove-btn">Remove</button>' +
            '</div>' +
            '<div class="form-group">' +
              '<label>Type</label>' +
              '<select name="hooks[' + n + '][type]" class="hook-type-select">' +
                '<option value="plugin">Plugin</option>' +
                '<option value="webhook">Webhook</option>' +
                '<option value="command">Command</option>' +
              '</select>' +
            '</div>' +
            '<div class="hook-dynamic-fields"></div>';

          wrapper.querySelector('.hook-remove-btn').addEventListener('click', function () {
            wrapper.remove();
          });

          var typeSelect = wrapper.querySelector('.hook-type-select');
          typeSelect.addEventListener('change', function () {
            renderHookFields(wrapper, n, typeSelect.value);
          });

          container.appendChild(wrapper);
          renderHookFields(wrapper, n, 'plugin');
        }

        addBtn.addEventListener('click', addHook);
      })();
    </script>`;
}
