import type { Notifier, NotificationEvent, NotificationSeverity } from "../types.js";
import type { NtfySettings } from "./schema.js";

function severityPriority(sev: NotificationSeverity): number {
  if (sev === "error") return 5;
  if (sev === "warning") return 4;
  return 3;
}

function severityTag(sev: NotificationSeverity): string {
  if (sev === "error") return "rotating_light";
  if (sev === "warning") return "warning";
  return "information_source";
}

export function createNtfyNotifier(settings: NtfySettings): Notifier {
  const base = settings.serverUrl.replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(settings.topic)}`;

  async function post(body: string, headers: Record<string, string>): Promise<void> {
    const merged: Record<string, string> = { ...headers };
    if (settings.bearerToken) {
      merged["Authorization"] = `Bearer ${settings.bearerToken}`;
    }
    const res = await fetch(url, { method: "POST", headers: merged, body });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ntfy ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
    }
  }

  return {
    async send(event: NotificationEvent): Promise<void> {
      const tags = [severityTag(event.severity), ...(settings.defaultTags ?? [])];
      const priority = settings.priority ?? severityPriority(event.severity);
      await post(event.message, {
        Title: event.title,
        Priority: String(priority),
        Tags: tags.join(","),
      });
    },

    async test(): Promise<void> {
      await post("Test notification from VPN Port Manager.", {
        Title: "Test notification",
        Priority: String(settings.priority ?? 3),
        Tags: "white_check_mark",
      });
    },
  };
}
