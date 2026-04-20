import type { Db } from "./db.js";
import type { SettingsService } from "./settings.js";
import type { VpnProvider } from "./providers/types.js";
import type { RouterClient } from "./routers/types.js";
import { createProvider } from "./providers/index.js";
import { createRouter } from "./routers/index.js";
import { createSyncWatchdog, type SyncWatchdog } from "./sync.js";

export interface Runtime {
  getProvider(): VpnProvider;
  getRouter(): RouterClient;
  getMaxPorts(): number;
  isReady(): boolean;
  reloadVpn(): void;
  reloadRouter(): void;
  reloadApp(): void;
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

  function rebuildProvider(): void {
    const vpn = settings.getVpn();
    provider = vpn ? createProvider(vpn) : null;
  }

  function rebuildRouter(): void {
    const r = settings.getRouter();
    router = r ? createRouter(r) : null;
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
    });
    watchdog.start(app.syncIntervalMinutes * 60_000);
    watchdog.runOnce().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[runtime] initial sync failed: ${message}`);
    });
  }

  rebuildProvider();
  rebuildRouter();
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
    stop(): void {
      watchdog?.stop();
      watchdog = null;
    },
  };
}
