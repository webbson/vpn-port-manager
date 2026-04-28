import type { Db } from "./db.js";
import type { SettingsService } from "./settings.js";
import type { VpnProvider } from "./providers/types.js";
import type { RouterClient } from "./routers/types.js";
import { createProvider } from "./providers/index.js";
import { createRouter } from "./routers/index.js";
import { createSyncWatchdog, type SyncWatchdog } from "./sync.js";
import { createNotifier } from "./notifications/index.js";
import {
  createNotifierDispatcher,
  createNoopDispatcher,
  type NotifierDispatcher,
} from "./notifications/dispatcher.js";

export interface Runtime {
  getProvider(): VpnProvider;
  getRouter(): RouterClient;
  getMaxPorts(): number;
  getNotifier(): NotifierDispatcher;
  isReady(): boolean;
  reloadVpn(): void;
  reloadRouter(): void;
  reloadApp(): void;
  reloadNotifications(): void;
  stop(): void;
}

export interface RuntimeConfig {
  db: Db;
  settings: SettingsService;
}

export function createRuntime(config: RuntimeConfig): Runtime {
  const { db, settings } = config;
  let provider: VpnProvider | null = null;
  let router: RouterClient | null = null;
  let watchdog: SyncWatchdog | null = null;
  let dispatcher: NotifierDispatcher = createNoopDispatcher();

  function rebuildProvider(): void {
    const vpn = settings.getVpn();
    provider = vpn ? createProvider(vpn) : null;
  }

  function rebuildRouter(): void {
    const r = settings.getRouter();
    router = r ? createRouter(r) : null;
  }

  function rebuildNotifier(): void {
    const n = settings.getNotifications();
    if (!n.enabled || !n.notifier) {
      dispatcher = createNoopDispatcher();
      return;
    }
    try {
      const notifier = createNotifier(n.notifier);
      dispatcher = createNotifierDispatcher({
        db,
        notifier,
        enabled: n.enabled,
        categories: n.categories,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[runtime] notifier build failed: ${message}`);
      dispatcher = createNoopDispatcher();
      throw err;
    }
  }

  function startOrRestartWatchdog(): void {
    watchdog?.stop();
    watchdog = null;
    if (!provider || !router) return;
    const app = settings.getApp();
    watchdog = createSyncWatchdog({
      db,
      provider,
      router,
      renewThresholdDays: app.renewThresholdDays,
      notifier: dispatcher,
      getLastExternalIp: () => settings.getLastExternalIp(),
      setLastExternalIp: (ip: string) => settings.setLastExternalIp(ip),
    });
    watchdog.start(app.syncIntervalMinutes * 60_000);
    watchdog.runOnce().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[runtime] initial sync failed: ${message}`);
    });
  }

  rebuildProvider();
  rebuildRouter();
  try {
    rebuildNotifier();
  } catch {
    // Bad stored notifier settings shouldn't prevent boot — runtime stays
    // usable with a no-op dispatcher. User will see the issue in /settings.
  }
  startOrRestartWatchdog();

  return {
    getProvider(): VpnProvider {
      if (!provider) throw new Error("VPN provider is not configured");
      return provider;
    },
    getRouter(): RouterClient {
      if (!router) throw new Error("Router is not configured");
      return router;
    },
    getMaxPorts(): number {
      const app = settings.getApp();
      if (app.maxPorts) return app.maxPorts;
      return provider ? provider.maxPorts : 0;
    },
    getNotifier(): NotifierDispatcher {
      return dispatcher;
    },
    isReady(): boolean {
      return provider !== null && router !== null;
    },
    reloadVpn(): void {
      rebuildProvider();
      startOrRestartWatchdog();
    },
    reloadRouter(): void {
      rebuildRouter();
      startOrRestartWatchdog();
    },
    reloadApp(): void {
      startOrRestartWatchdog();
    },
    reloadNotifications(): void {
      rebuildNotifier();
      // Watchdog captures the dispatcher reference at construction time, so we
      // need to rebuild it to pick up the new one.
      startOrRestartWatchdog();
    },
    stop(): void {
      watchdog?.stop();
      watchdog = null;
    },
  };
}
