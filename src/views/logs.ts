import type { SyncLogEntry } from '../db.js';
import { escHtml } from './layout.js';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function logsView(logs: SyncLogEntry[]): string {
  const tableBody = logs.length === 0
    ? `<tr><td colspan="4">
        <div class="empty-state">No log entries yet.</div>
       </td></tr>`
    : logs.map((entry) => `
        <tr>
          <td class="muted" style="white-space:nowrap;">${escHtml(formatTime(entry.timestamp))}</td>
          <td>${escHtml(entry.action)}</td>
          <td class="muted">${entry.mappingId ? escHtml(entry.mappingId) : '—'}</td>
          <td><code>${escHtml(entry.details)}</code></td>
        </tr>`).join('');

  return `
    <div class="page-header">
      <h1>Sync Logs</h1>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Mapping ID</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${tableBody}
        </tbody>
      </table>
    </div>`;
}
