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
        const method: string = config.method ?? "POST";
        const headers: Record<string, string> = config.headers ?? {};

        try {
          const response = await fetch(config.url as string, {
            method,
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify(payload),
          });

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
