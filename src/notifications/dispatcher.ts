import type { Db } from "../db.js";
import type { Notifier, NotificationCategory, NotificationEvent } from "./types.js";

export interface NotifierDispatcher {
  emit(event: NotificationEvent): void;
}

export interface DispatcherConfig {
  db: Db;
  notifier: Notifier | null;
  enabled: boolean;
  categories: Partial<Record<NotificationCategory, boolean>>;
}

// Fire-and-forget wrapper around a Notifier. Never throws into the caller's
// hot path — failures are written to sync_log so they're visible in /logs but
// don't cascade into sync ticks or HTTP responses. Unknown categories
// (including those added after the user last saved settings) default to ON.
export function createNotifierDispatcher(config: DispatcherConfig): NotifierDispatcher {
  const { db, notifier, enabled, categories } = config;

  function shouldSend(category: NotificationCategory): boolean {
    if (!enabled || !notifier) return false;
    const explicit = categories[category];
    return explicit === undefined ? true : explicit;
  }

  return {
    emit(event: NotificationEvent): void {
      if (!shouldSend(event.category)) return;
      notifier!
        .send(event)
        .then(() => {
          db.logSync("notify", event.mappingId ?? null, {
            category: event.category,
            severity: event.severity,
            status: "ok",
          });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          db.logSync("notify", event.mappingId ?? null, {
            category: event.category,
            severity: event.severity,
            status: "error",
            error: message,
          });
        });
    },
  };
}

// Dispatcher that silently drops every event. Used when notifications are
// disabled or unconfigured so callers don't have to branch.
export function createNoopDispatcher(): NotifierDispatcher {
  return { emit() {} };
}
