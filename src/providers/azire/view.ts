import { escHtml } from "../../views/layout.js";
import type { AzireSettings } from "./schema.js";

export function azireFields(stored: AzireSettings | null): string {
  const configured = stored !== null;
  const internalIp = stored?.internalIp ?? "";
  return `
    <div class="form-group">
      <label for="azire-apiToken">API token</label>
      <input id="azire-apiToken" name="apiToken" type="text" placeholder="${configured ? "•••••• (stored, leave blank to keep)" : "Bearer token"}" autocomplete="off" />
    </div>
    <div class="form-group">
      <label for="azire-internalIp">Internal VPN IP</label>
      <input id="azire-internalIp" name="internalIp" type="text" value="${escHtml(internalIp)}" placeholder="10.0.16.181" />
    </div>
  `;
}

export const AZIRE_READER_NAME = "readAzireForm";

export const azireReaderScript = `
  function ${AZIRE_READER_NAME}(opts) {
    const requireSecret = opts && opts.requireSecret;
    const token = document.getElementById('azire-apiToken').value.trim();
    if (!token && requireSecret) throw new Error('API token required');
    return {
      provider: 'azire',
      apiToken: token,
      internalIp: document.getElementById('azire-internalIp').value.trim(),
    };
  }
`;
