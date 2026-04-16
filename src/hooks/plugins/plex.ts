import type { HookPlugin, HookPayload, HookResult } from "../types.js";

export const plexPlugin: HookPlugin = {
  name: "plex",

  async execute(config: Record<string, any>, payload: HookPayload): Promise<HookResult> {
    if (payload.newPort === null) {
      return { success: true };
    }

    const url = `${config.host}/:/prefs?ManualPortMappingPort=${payload.newPort}&X-Plex-Token=${config.token}`;

    try {
      const response = await fetch(url, { method: "PUT" });

      if (!response.ok) {
        return {
          success: false,
          error: `Plex API error (${response.status}): ${response.statusText}`,
        };
      }

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Plex connection error: ${message}` };
    }
  },
};
