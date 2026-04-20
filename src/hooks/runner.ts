import type { HookPayload, HookResult, HookPlugin } from "./types.js";
import { plexPlugin } from "./plugins/plex.js";

export interface HookDef {
  type: string;
  config: string; // JSON string
}

export interface HookRunner {
  execute(hook: HookDef, payload: HookPayload): Promise<HookResult>;
}

const plugins: Record<string, HookPlugin> = {
  plex: plexPlugin,
};

export function createHookRunner(): HookRunner {
  async function execute(hook: HookDef, payload: HookPayload): Promise<HookResult> {
    let config: Record<string, any>;
    try {
      config = JSON.parse(hook.config);
    } catch {
      return { success: false, error: "Invalid hook config JSON" };
    }

    switch (hook.type) {
      case "plugin": {
        const plugin = plugins[config.plugin as string];
        if (!plugin) {
          return { success: false, error: `Unknown plugin: ${config.plugin}` };
        }
        return plugin.execute(config, payload);
      }

      case "webhook": {
        const method: string = (config.method ?? "POST").toString().toUpperCase();
        const headers: Record<string, string> = config.headers ?? {};
        const urlInput = config.url as string;

        try {
          let target = urlInput;
          const init: RequestInit = { method, headers: { ...headers } };

          if (method === "GET") {
            // GET has no body; serialise the payload onto the URL instead so
            // receivers like n8n / Shortcuts can read it from ?query params.
            const url = new URL(urlInput);
            for (const [key, value] of Object.entries(payload)) {
              if (value === null || value === undefined) continue;
              url.searchParams.set(key, String(value));
            }
            target = url.toString();
          } else {
            init.headers = { "Content-Type": "application/json", ...headers };
            init.body = JSON.stringify(payload);
          }

          const response = await fetch(target, init);

          if (!response.ok) {
            return {
              success: false,
              error: `Webhook error (${response.status}): ${response.statusText}`,
            };
          }

          return { success: true };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, error: `Webhook connection error: ${message}` };
        }
      }

      default:
        return { success: false, error: `Unknown hook type: ${hook.type}` };
    }
  }

  return { execute };
}
