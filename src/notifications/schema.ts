import { z } from "zod";
import type { NotificationCategory } from "./types.js";
import { notifierSettingsSchema } from "./registry.js";

// Categories map is partial: keys are treated as `NotificationCategory` at
// runtime but stored as plain strings so future categories don't invalidate
// old blobs. Unknown categories default to ON at dispatch time.
export const notificationsSettingsSchema = z.object({
  enabled: z.boolean(),
  notifier: notifierSettingsSchema.nullable(),
  categories: z.record(z.string(), z.boolean()).default({}),
});

export type NotificationsSettings = Omit<
  z.infer<typeof notificationsSettingsSchema>,
  "categories"
> & {
  categories: Partial<Record<NotificationCategory, boolean>>;
};

export const DEFAULT_NOTIFICATIONS_SETTINGS: NotificationsSettings = {
  enabled: false,
  notifier: null,
  categories: {},
};
