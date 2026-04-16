import type { VpnProvider } from "./types.js";
import { createAzireProvider } from "./azire.js";
import type { Config } from "../config.js";

export type { VpnProvider, ProviderPort } from "./types.js";

export function createProvider(config: Config): VpnProvider {
  switch (config.vpnProvider) {
    case "azire":
      return createAzireProvider({
        apiToken: config.vpnApiToken,
        internalIp: config.vpnInternalIp,
      });
    default:
      throw new Error(`Unknown VPN provider: ${config.vpnProvider}`);
  }
}
