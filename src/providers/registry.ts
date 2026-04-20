import type { z } from "zod";
import type { VpnProvider } from "./types.js";
import { azireDefinition } from "./azire/index.js";

export interface ProviderDefinition<T = unknown> {
  id: string;
  label: string;
  schema: z.ZodType<T>;
  create(settings: T): VpnProvider;
  describeStored(settings: T): Record<string, unknown>;
  renderFields(stored: T | null): string;
  readerName: string;
  readerScript: string;
}

// Register new providers here.
export const providerDefinitions: ProviderDefinition[] = [
  azireDefinition as ProviderDefinition,
];

export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return providerDefinitions.find((d) => d.id === id);
}

// Combined schema used to validate stored VPN settings. With one provider we
// just use its schema directly; when a second provider lands, switch to
// z.discriminatedUnion("provider", [...]).
export const vpnSettingsSchema = azireDefinition.schema;
