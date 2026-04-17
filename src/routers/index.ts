import type { RouterClient, RouterSettings } from "./types.js";
import { createUnifiRouter } from "./unifi/client.js";

export function createRouter(settings: RouterSettings): RouterClient {
  switch (settings.type) {
    case "unifi":
      return createUnifiRouter(settings);
    default: {
      const exhaustive: never = settings.type;
      throw new Error(`Unknown router type: ${exhaustive as string}`);
    }
  }
}

export type { RouterClient, RouterSettings, PortForwardSpec, RouterHandle, Protocol, RouterTestResult } from "./types.js";
