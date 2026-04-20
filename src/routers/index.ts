import type { RouterClient } from "./types.js";
import type { RouterSettings } from "../settings.js";
import { getRouterDefinition } from "./registry.js";

export function createRouter(settings: RouterSettings): RouterClient {
  const def = getRouterDefinition(settings.type);
  if (!def) throw new Error(`Unknown router type: ${settings.type}`);
  return def.create(settings);
}

export type {
  RouterClient,
  RouterHandle,
  PortForwardSpec,
  Protocol,
  RouterTestResult,
} from "./types.js";
