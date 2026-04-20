export function layout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)} - VPN Port Manager</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #0f1117;
      color: #e1e4e8;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }

    nav {
      background: #161b22;
      border-bottom: 1px solid #30363d;
      padding: 0 24px;
      display: flex;
      align-items: center;
      gap: 24px;
      height: 52px;
    }

    nav .nav-brand {
      font-weight: 700;
      font-size: 15px;
      color: #e1e4e8;
      text-decoration: none;
      margin-right: 8px;
    }

    nav a {
      color: #8b949e;
      text-decoration: none;
      font-size: 14px;
      padding: 4px 8px;
      border-radius: 6px;
      transition: color 0.15s, background 0.15s;
    }

    nav a:hover {
      color: #e1e4e8;
      background: #21262d;
    }

    .container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 28px 24px;
    }

    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 20px 24px;
    }

    .cards-row {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 28px;
    }

    .cards-row .card {
      flex: 1;
      min-width: 220px;
    }

    .card h3 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #8b949e;
      margin-bottom: 10px;
    }

    .card .card-value {
      font-size: 22px;
      font-weight: 600;
      color: #e1e4e8;
    }

    /* Health indicator */
    .health {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-size: 15px;
      font-weight: 600;
    }

    .health-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .health-dot.ok  { background: #3fb950; box-shadow: 0 0 6px #3fb950aa; }
    .health-dot.err { background: #f85149; box-shadow: 0 0 6px #f85149aa; }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 2px 9px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.03em;
    }

    .badge.active  { background: #1f4e2c; color: #3fb950; border: 1px solid #3fb95055; }
    .badge.pending { background: #3d2f05; color: #d29922; border: 1px solid #d2992255; }
    .badge.error   { background: #4e1e1e; color: #f85149; border: 1px solid #f8514955; }
    .badge.expired { background: #1e1e2e; color: #8b949e; border: 1px solid #30363d; }

    /* Buttons */
    .btn {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      text-decoration: none;
      transition: opacity 0.15s;
    }

    .btn:hover { opacity: 0.82; }

    .btn.primary {
      background: #238636;
      color: #fff;
      border-color: #2ea043;
    }

    .btn.secondary {
      background: #21262d;
      color: #c9d1d9;
      border-color: #30363d;
    }

    .btn.danger {
      background: #4e1e1e;
      color: #f85149;
      border-color: #f8514955;
    }

    /* Port number */
    .port-num {
      font-family: 'SFMono-Regular', Consolas, monospace;
      color: #58a6ff;
      font-weight: 600;
    }

    button.port-copy {
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      font-size: inherit;
    }
    button.port-copy:hover { text-decoration: underline; }
    button.port-copy.copied { color: #3fb950; }

    .muted {
      color: #8b949e;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    thead th {
      text-align: left;
      padding: 10px 12px;
      color: #8b949e;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #30363d;
    }

    tbody tr {
      border-bottom: 1px solid #21262d;
    }

    tbody tr:last-child {
      border-bottom: none;
    }

    tbody td {
      padding: 11px 12px;
      vertical-align: middle;
    }

    .table-wrap {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 10px;
      overflow: hidden;
    }

    .table-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px 14px;
      border-bottom: 1px solid #30363d;
    }

    .table-header h2 {
      font-size: 16px;
      font-weight: 600;
    }

    /* Empty state */
    .empty-state {
      padding: 48px 24px;
      text-align: center;
      color: #8b949e;
    }

    .empty-state a { color: #58a6ff; }

    /* Forms */
    .form-group {
      margin-bottom: 18px;
    }

    .form-help {
      font-size: 12px;
      color: #8b949e;
      margin-top: 4px;
      line-height: 1.4;
    }
    .form-help:empty { display: none; }

    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #c9d1d9;
      margin-bottom: 6px;
    }

    input[type=text], input[type=password], input[type=number], select, textarea {
      width: 100%;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #e1e4e8;
      padding: 8px 12px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s;
    }

    input[type=text]:focus, input[type=password]:focus, input[type=number]:focus, select:focus, textarea:focus {
      border-color: #58a6ff;
    }

    input[disabled], select[disabled] {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .form-actions {
      margin-top: 24px;
      display: flex;
      gap: 10px;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .page-header h1 {
      font-size: 22px;
      font-weight: 700;
    }

    code {
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 12px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 4px;
      padding: 1px 6px;
      color: #e1e4e8;
      word-break: break-all;
    }

    .hook-item {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }

    .hook-item .hook-type {
      font-weight: 600;
      font-size: 13px;
      color: #58a6ff;
      margin-bottom: 4px;
    }

    .hook-item .hook-config {
      font-size: 12px;
      color: #8b949e;
      font-family: monospace;
    }

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #c9d1d9;
      margin: 24px 0 12px;
    }

    .info-box {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 20px;
      font-size: 13px;
      color: #8b949e;
    }

    .info-box strong { color: #e1e4e8; }

    /* Dynamic hook builder */
    .hook-builder-item {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
    }

    .hook-builder-item .hook-row {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
    }

    .hook-builder-item .hook-row .form-group {
      margin-bottom: 0;
      flex: 1;
      min-width: 140px;
    }

    .hook-remove-btn {
      background: none;
      border: 1px solid #f8514955;
      color: #f85149;
      border-radius: 6px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 13px;
      flex-shrink: 0;
    }

    .hook-remove-btn:hover { background: #4e1e1e; }

    .banner {
      background: #3d2f05;
      color: #d29922;
      border-bottom: 1px solid #d2992255;
      padding: 10px 24px;
      display: none;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
    }
    .banner.show { display: flex; }
    .banner button {
      background: none;
      border: 1px solid #d2992255;
      color: #d29922;
      border-radius: 6px;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 12px;
    }
    .banner button:hover { background: #d2992222; }
  </style>
</head>
<body>
  <div id="restart-banner" class="banner">
    <span id="restart-banner-msg"><strong>Configuration saved but live reload failed.</strong> Restart the container to apply the new settings.</span>
    <button onclick="localStorage.removeItem('restartRequired');localStorage.removeItem('reloadError');this.parentElement.classList.remove('show')">Dismiss</button>
  </div>
  <nav>
    <a class="nav-brand" href="/">VPN Port Manager</a>
    <a href="/">Dashboard</a>
    <a href="/create">New Mapping</a>
    <a href="/logs">Logs</a>
    <a href="/settings">Settings</a>
  </nav>
  <div class="container">
    ${content}
  </div>
  <script>
    if (localStorage.getItem('restartRequired') === '1') {
      var err = localStorage.getItem('reloadError');
      if (err) {
        document.getElementById('restart-banner-msg').innerHTML =
          '<strong>Live reload failed:</strong> ' + err.replace(/</g, '&lt;') +
          '. Restart the container to apply the new settings.';
      }
      document.getElementById('restart-banner').classList.add('show');
    }

    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('button.port-copy');
      if (!btn) return;
      var text = btn.dataset.copy || '';
      if (!text) return;
      var orig = btn.textContent;
      var done = function () {
        btn.classList.add('copied');
        btn.textContent = 'Copied!';
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.textContent = orig;
        }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
          fallbackCopy(text);
          done();
        });
      } else {
        fallbackCopy(text);
        done();
      }
    });
    function fallbackCopy(text) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) {}
    }
  </script>
</body>
</html>`;
}

/** Escape HTML special characters */
export function escHtml(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
