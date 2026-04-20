import type { z } from "zod";
import type { Notifier } from "./types.js";
import { ntfyDefinition } from "./ntfy/index.js";

export interface NotifierDefinition<T = unknown> {
  id: string;
  label: string;
  schema: z.ZodType<T>;
  create(settings: T): Notifier;
  describeStored(settings: T): Record<string, unknown>;
  renderFields(stored: T | null): string;
  readerName: string;
  readerScript: string;
}

// Register new notifier backends here.
export const notifierDefinitions: NotifierDefinition[] = [
  ntfyDefinition as NotifierDefinition,
];

export function getNotifierDefinition(id: string): NotifierDefinition | undefined {
  return notifierDefinitions.find((d) => d.id === id);
}

// Single-backend discriminator. When a second backend lands, switch to
// z.discriminatedUnion("provider", [...]).
export const notifierSettingsSchema = ntfyDefinition.schema;
