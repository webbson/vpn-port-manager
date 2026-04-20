import type { z } from "zod";
import type { RouterClient } from "./types.js";
import { unifiDefinition } from "./unifi/index.js";

export interface RouterDefinition<T = unknown> {
  id: string;
  label: string;
  schema: z.ZodType<T>;
  create(settings: T): RouterClient;
  describeStored(settings: T): Record<string, unknown>;
  renderFields(stored: T | null): string;
  readerName: string;
  readerScript: string;
  discover?: (body: unknown) => Promise<unknown>;
}

// Register new routers here.
export const routerDefinitions: RouterDefinition[] = [
  unifiDefinition as RouterDefinition,
];

export function getRouterDefinition(id: string): RouterDefinition | undefined {
  return routerDefinitions.find((d) => d.id === id);
}

// Combined schema used to validate stored router settings. With one router we
// just use its schema directly; when a second router lands, switch to
// z.discriminatedUnion("type", [...]).
export const routerSettingsSchema = unifiDefinition.schema;
