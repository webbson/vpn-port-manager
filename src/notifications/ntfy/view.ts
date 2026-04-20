import { escHtml } from "../../views/layout.js";
import type { NtfySettings } from "./schema.js";

export function ntfyFields(stored: NtfySettings | null): string {
  const configured = stored !== null;
  const serverUrl = stored?.serverUrl ?? "https://ntfy.sh";
  const topic = stored?.topic ?? "";
  const priority = stored?.priority ?? "";
  const tags = (stored?.defaultTags ?? []).join(",");
  return `
    <div class="form-group">
      <label for="ntfy-serverUrl">Server URL</label>
      <input id="ntfy-serverUrl" name="serverUrl" type="text" value="${escHtml(serverUrl)}" placeholder="https://ntfy.sh" />
    </div>
    <div class="form-group">
      <label for="ntfy-topic">Topic</label>
      <input id="ntfy-topic" name="topic" type="text" value="${escHtml(topic)}" placeholder="my-topic" />
    </div>
    <div class="form-group">
      <label for="ntfy-bearerToken">Bearer token (optional)</label>
      <input id="ntfy-bearerToken" name="bearerToken" type="text" placeholder="${configured ? "•••••• (stored, leave blank to keep)" : "tk_…"}" autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="ntfy-priority">Default priority (1–5, blank = from severity)</label>
      <input id="ntfy-priority" name="priority" type="number" min="1" max="5" value="${escHtml(String(priority))}" />
    </div>
    <div class="form-group">
      <label for="ntfy-defaultTags">Default tags (comma-separated)</label>
      <input id="ntfy-defaultTags" name="defaultTags" type="text" value="${escHtml(tags)}" placeholder="vpn,portmanager" />
    </div>
  `;
}

export const NTFY_READER_NAME = "readNtfyForm";

export const ntfyReaderScript = `
  function ${NTFY_READER_NAME}(_opts) {
    const serverUrl = document.getElementById('ntfy-serverUrl').value.trim();
    const topic = document.getElementById('ntfy-topic').value.trim();
    const token = document.getElementById('ntfy-bearerToken').value.trim();
    const priorityRaw = document.getElementById('ntfy-priority').value.trim();
    const tagsRaw = document.getElementById('ntfy-defaultTags').value.trim();
    if (!topic) throw new Error('Topic required');
    if (!serverUrl) throw new Error('Server URL required');
    const out = { provider: 'ntfy', serverUrl: serverUrl, topic: topic };
    if (token) out.bearerToken = token;
    if (priorityRaw) out.priority = Number(priorityRaw);
    if (tagsRaw) out.defaultTags = tagsRaw.split(',').map(function(s){return s.trim();}).filter(Boolean);
    return out;
  }
`;
