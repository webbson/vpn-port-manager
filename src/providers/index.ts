import type { VpnProvider } from "./types.js";
import type { VpnSettings } from "../settings.js";
import { getProviderDefinition } from "./registry.js";

export type { VpnProvider, ProviderPort } from "./types.js";

export function createProvider(settings: VpnSettings): VpnProvider {
  const def = getProviderDefinition(settings.provider);
  if (!def) throw new Error(`Unknown VPN provider: ${settings.provider}`);
  return def.create(settings);
}
