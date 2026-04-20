import { describe, it, expect, beforeEach, vi } from "vitest";
import { createDb, type Db } from "../src/db.js";
import { createSettingsService } from "../src/settings.js";
import { createRuntime } from "../src/runtime.js";

const KEY = "sixteen-or-more-chars-key";

vi.mock("../src/providers/index.js", () => {
  return {
    createProvider: vi.fn((settings: { provider: string; apiToken: string }) => ({
      name: settings.provider,
      maxPorts: 5,
      listPorts: vi.fn().mockResolvedValue([]),
      createPort: vi.fn(),
      deletePort: vi.fn(),
      checkPort: vi.fn(),
      __token: settings.apiToken,
    })),
  };
});

vi.mock("../src/routers/index.js", () => {
  return {
    createRouter: vi.fn((settings: { type: string; host: string }) => ({
      name: settings.type,
      login: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      ensurePortForward: vi.fn(),
      updatePortForward: vi.fn(),
      deletePortForward: vi.fn(),
      repairPortForward: vi.fn(),
      __host: settings.host,
    })),
  };
});

vi.mock("../src/sync.js", () => {
  return {
    createSyncWatchdog: vi.fn(() => ({
      runOnce: vi.fn().mockResolvedValue(undefined),
      start: vi.fn(),
      stop: vi.fn(),
    })),
  };
});

describe("runtime", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  it("is not ready when settings are empty", () => {
    const settings = createSettingsService(db, KEY);
    const runtime = createRuntime({ db, settings });
    expect(runtime.isReady()).toBe(false);
    expect(() => runtime.getProvider()).toThrow();
    expect(() => runtime.getRouter()).toThrow();
    runtime.stop();
  });

  it("becomes ready after VPN + router settings are written and reloadVpn/reloadRouter are called", () => {
    const settings = createSettingsService(db, KEY);
    const runtime = createRuntime({ db, settings });

    settings.setVpn({ provider: "azire", apiToken: "t1", internalIp: "10.0.0.1" });
    runtime.reloadVpn();
    expect(runtime.isReady()).toBe(false);

    settings.setRouter({
      type: "unifi",
      host: "https://1.2.3.4",
      username: "admin",
      password: "p",
      inInterfaceId: "i",
      sourceZoneId: "s",
      destinationZoneId: "d",
    });
    runtime.reloadRouter();

    expect(runtime.isReady()).toBe(true);
    expect(runtime.getProvider().name).toBe("azire");
    expect(runtime.getRouter().name).toBe("unifi");
    runtime.stop();
  });

  it("reloadVpn swaps the provider instance after settings change", async () => {
    const settings = createSettingsService(db, KEY);
    settings.setVpn({ provider: "azire", apiToken: "first", internalIp: "10.0.0.1" });
    settings.setRouter({
      type: "unifi",
      host: "https://1.2.3.4",
      username: "admin",
      password: "p",
      inInterfaceId: "i",
      sourceZoneId: "s",
      destinationZoneId: "d",
    });
    const runtime = createRuntime({ db, settings });

    const p1 = runtime.getProvider() as { __token: string };
    expect(p1.__token).toBe("first");

    settings.setVpn({ provider: "azire", apiToken: "second", internalIp: "10.0.0.1" });
    runtime.reloadVpn();

    const p2 = runtime.getProvider() as { __token: string };
    expect(p2.__token).toBe("second");
    runtime.stop();
  });

  it("getMaxPorts respects appSettings.maxPorts override", () => {
    const settings = createSettingsService(db, KEY);
    settings.setVpn({ provider: "azire", apiToken: "t", internalIp: "10.0.0.1" });
    settings.setRouter({
      type: "unifi",
      host: "https://1.2.3.4",
      username: "admin",
      password: "p",
      inInterfaceId: "i",
      sourceZoneId: "s",
      destinationZoneId: "d",
    });
    const runtime = createRuntime({ db, settings });

    expect(runtime.getMaxPorts()).toBe(5);

    settings.setApp({ maxPorts: 2, syncIntervalMinutes: 1, renewThresholdDays: 7 });
    runtime.reloadApp();
    expect(runtime.getMaxPorts()).toBe(2);
    runtime.stop();
  });
});
