import { execSync } from "child_process";
import type { HookPayload, HookResult, HookPlugin } from "./types.js";
import { plexPlugin } from "./plugins/plex.js";

export interface HookDef {
  type: string;
  config: string; // JSON string
}

export interface HookRunner {
  execute(hook: HookDef, payload: HookPayload): Promise<HookResult>;
  resolveTemplate(template: string, payload: HookPayload): string;
}

const plugins: Record<string, HookPlugin> = {
  plex: plexPlugin,
};

export function createHookRunner(): HookRunner {
  function resolveTemplate(template: string, payload: HookPayload): string {
    return template
      .replace(/\{\{mappingId\}\}/g, payload.mappingId)
      .replace(/\{\{label\}\}/g, payload.label)
      .replace(/\{\{oldPort\}\}/g, payload.oldPort === null ? "" : String(payload.oldPort))
      .replace(/\{\{newPort\}\}/g, payload.newPort === null ? "" : String(payload.newPort))
      .replace(/\{\{destIp\}\}/g, payload.destIp)
      .replace(/\{\{destPort\}\}/g, String(payload.destPort));
  }

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

      case "command": {
        const command = resolveTemplate(config.command as string, payload);
        try {
          execSync(command, { timeout: 30000 });
          return { success: true };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, error: message };
        }
      }

      default:
        return { success: false, error: `Unknown hook type: ${hook.type}` };
    }
  }

  return { execute, resolveTemplate };
}
