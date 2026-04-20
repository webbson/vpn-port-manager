import type { ProviderDefinition } from "../registry.js";
import { createAzireProvider } from "./client.js";
import { azireSettingsSchema, describeAzire, type AzireSettings } from "./schema.js";
import { AZIRE_READER_NAME, azireFields, azireReaderScript } from "./view.js";

export const azireDefinition: ProviderDefinition<AzireSettings> = {
  id: "azire",
  label: "Azire VPN",
  schema: azireSettingsSchema,
  create: (settings) =>
    createAzireProvider({
      apiToken: settings.apiToken,
      internalIp: settings.internalIp,
    }),
  describeStored: describeAzire,
  renderFields: (stored) => azireFields(stored),
  readerName: AZIRE_READER_NAME,
  readerScript: azireReaderScript,
};

export type { AzireSettings };
