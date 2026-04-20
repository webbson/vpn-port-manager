import type { RouterDefinition } from "../registry.js";
import { createUnifiRouter } from "./client.js";
import { discoverUnifi } from "./discovery.js";
import { unifiRouterSchema, describeUnifi, type UnifiRouterSettings } from "./schema.js";
import { UNIFI_READER_NAME, unifiFields, unifiReaderScript } from "./view.js";

export const unifiDefinition: RouterDefinition<UnifiRouterSettings> = {
  id: "unifi",
  label: "UniFi (UDM-Pro)",
  schema: unifiRouterSchema,
  create: createUnifiRouter,
  describeStored: describeUnifi,
  renderFields: (stored) => unifiFields(stored),
  readerName: UNIFI_READER_NAME,
  readerScript: unifiReaderScript,
  discover: async (body) => {
    const b = body as { host?: string; username?: string; password?: string };
    if (!b.host || !b.username || !b.password) {
      return { ok: false, error: "missing host, username or password" };
    }
    try {
      const result = await discoverUnifi({ host: b.host, username: b.username, password: b.password });
      return { ok: true, ...result };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export type { UnifiRouterSettings };
