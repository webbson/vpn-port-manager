export const NOTIFICATION_CATEGORIES = [
  "port.renewed",
  "port.expired",
  "port.recreated",
  "port.recreate_failed",
  "router.repair_failed",
  "provider.login_failed",
  "mapping.create_failed",
  "mapping.update_failed",
  "mapping.delete_failed",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationSeverity = "info" | "warning" | "error";

export interface NotificationEvent {
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  mappingId?: string;
  data?: Record<string, unknown>;
}

export interface Notifier {
  send(event: NotificationEvent): Promise<void>;
  test(): Promise<void>;
}
