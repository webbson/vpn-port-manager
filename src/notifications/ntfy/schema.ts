import { z } from "zod";

export const ntfySettingsSchema = z.object({
  provider: z.literal("ntfy"),
  serverUrl: z.string().url(),
  topic: z.string().min(1),
  bearerToken: z.string().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  defaultTags: z.array(z.string().min(1)).optional(),
});
export type NtfySettings = z.infer<typeof ntfySettingsSchema>;

export function describeNtfy(s: NtfySettings): Record<string, unknown> {
  return {
    provider: s.provider,
    serverUrl: s.serverUrl,
    topic: s.topic,
    hasBearerToken: Boolean(s.bearerToken),
    priority: s.priority ?? null,
    defaultTags: s.defaultTags ?? [],
  };
}
