import type { VpnProvider } from "./types.js";
import { createAzireProvider } from "./azire.js";
import type { VpnSettings } from "../settings.js";

export type { VpnProvider, ProviderPort } from "./types.js";

export function createProvider(settings: VpnSettings): VpnProvider {
  switch (settings.provider) {
    case "azire":
      return createAzireProvider({
        apiToken: settings.apiToken,
        internalIp: settings.internalIp,
      });
    default: {
      const exhaustive: never = settings.provider;
      throw new Error(`Unknown VPN provider: ${exhaustive as string}`);
    }
  }
}
