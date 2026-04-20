import type { Db } from "../db.js";
import type { ProviderPort, VpnProvider } from "../providers/types.js";

export async function listDanglingPorts(
  provider: VpnProvider,
  db: Db
): Promise<ProviderPort[]> {
  const providerPorts = await provider.listPorts();
  const tracked = new Set(
    db
      .listMappings()
      .filter((m) => m.status !== "expired")
      .map((m) => m.vpnPort)
  );
  return providerPorts.filter((p) => !tracked.has(p.port));
}
