import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDb, type Db } from "../../src/db.js";
import { createNotifierDispatcher, createNoopDispatcher } from "../../src/notifications/dispatcher.js";
import type { Notifier, NotificationEvent } from "../../src/notifications/types.js";

function mockNotifier(): Notifier & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    test: vi.fn().mockResolvedValue(undefined),
  } as unknown as Notifier & { send: ReturnType<typeof vi.fn> };
}

const ev: NotificationEvent = {
  category: "port.renewed",
  severity: "info",
  title: "t",
  message: "m",
};

describe("notifier dispatcher", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("no-op dispatcher never throws and silently ignores emit", () => {
    const d = createNoopDispatcher();
    expect(() => d.emit(ev)).not.toThrow();
  });

  it("does nothing when enabled is false", async () => {
    const notifier = mockNotifier();
    const d = createNotifierDispatcher({ db, notifier, enabled: false, categories: {} });
    d.emit(ev);
    await new Promise((r) => setImmediate(r));
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it("does nothing when notifier is null even if enabled", async () => {
    const d = createNotifierDispatcher({ db, notifier: null, enabled: true, categories: {} });
    expect(() => d.emit(ev)).not.toThrow();
  });

  it("fires when category is explicitly enabled", async () => {
    const notifier = mockNotifier();
    const d = createNotifierDispatcher({
      db,
      notifier,
      enabled: true,
      categories: { "port.renewed": true },
    });
    d.emit(ev);
    await new Promise((r) => setImmediate(r));
    expect(notifier.send).toHaveBeenCalledOnce();
  });

  it("suppresses when category is explicitly disabled", async () => {
    const notifier = mockNotifier();
    const d = createNotifierDispatcher({
      db,
      notifier,
      enabled: true,
      categories: { "port.renewed": false },
    });
    d.emit(ev);
    await new Promise((r) => setImmediate(r));
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it("defaults to ON for categories that are absent from the map", async () => {
    const notifier = mockNotifier();
    const d = createNotifierDispatcher({ db, notifier, enabled: true, categories: {} });
    d.emit(ev);
    await new Promise((r) => setImmediate(r));
    expect(notifier.send).toHaveBeenCalledOnce();
  });

  it("writes a notify sync_log row on success", async () => {
    const notifier = mockNotifier();
    const d = createNotifierDispatcher({ db, notifier, enabled: true, categories: {} });
    d.emit(ev);
    await new Promise((r) => setImmediate(r));
    const logs = db.getRecentLogs(10);
    const notify = logs.find((l) => l.action === "notify");
    expect(notify).toBeDefined();
    const meta = JSON.parse(notify!.details) as Record<string, unknown>;
    expect(meta.status).toBe("ok");
    expect(meta.category).toBe("port.renewed");
  });

  it("catches notifier errors and logs them without throwing into the caller", async () => {
    const notifier: Notifier = {
      send: vi.fn().mockRejectedValue(new Error("network down")),
      test: vi.fn().mockResolvedValue(undefined),
    };
    const d = createNotifierDispatcher({ db, notifier, enabled: true, categories: {} });
    expect(() => d.emit(ev)).not.toThrow();
    await new Promise((r) => setImmediate(r));
    const logs = db.getRecentLogs(10);
    const notify = logs.find((l) => l.action === "notify");
    const meta = JSON.parse(notify!.details) as Record<string, unknown>;
    expect(meta.status).toBe("error");
    expect(meta.error).toBe("network down");
  });
});
