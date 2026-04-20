import { z } from "zod";

export const azireSettingsSchema = z.object({
  provider: z.literal("azire"),
  apiToken: z.string().min(1),
  internalIp: z.string().min(1),
});
export type AzireSettings = z.infer<typeof azireSettingsSchema>;

export function describeAzire(s: AzireSettings): Record<string, unknown> {
  return { provider: s.provider, internalIp: s.internalIp };
}
