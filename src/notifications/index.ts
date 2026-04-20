import type { Notifier } from "./types.js";
import { getNotifierDefinition } from "./registry.js";
import type { z } from "zod";
import type { notifierSettingsSchema } from "./registry.js";

export type NotifierSettings = z.infer<typeof notifierSettingsSchema>;

export function createNotifier(settings: NotifierSettings): Notifier {
  // `provider` is the discriminator in every notifier schema.
  const id = (settings as { provider: string }).provider;
  const def = getNotifierDefinition(id);
  if (!def) throw new Error(`Unknown notifier: ${id}`);
  return def.create(settings);
}
