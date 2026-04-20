import type { Db, RouterHandle } from "./db.js";
import type { VpnProvider } from "./providers/types.js";
import type { PortForwardSpec, Protocol, RouterClient } from "./routers/types.js";
import { createHookRunner } from "./hooks/runner.js";
import { fireHooksForMapping, buildHookPayload, type HookPayloadBase } from "./hooks/fire.js";
import type { HookPayload } from "./hooks/types.js";
import type { PortMapping } from "./db.js";
import type { NotifierDispatcher } from "./notifications/dispatcher.js";
import { createNoopDispatcher } from "./notifications/dispatcher.js";

export interface SyncConfig {
  db: Db;
  provider: VpnProvider;
  router: RouterClient;
  renewThresholdDays: number;
  notifier?: NotifierDispatcher;
}

export interface SyncWatchdog {
  runOnce(): Promise<void>;
  start(intervalMs: number): void;
  stop(): void;
}

function toRouterProtocol(p: string): Protocol {
  if (p === "tcp" || p === "udp") return p;
  return "tcp_udp";
}

function specFromMapping(m: PortMapping): PortForwardSpec {
  return {
    vpnPort: m.vpnPort,
    destIp: m.destIp,
    destPort: m.destPort,
    protocol: toRouterProtocol(m.protocol),
    label: m.label,
  };
}

export function createSyncWatchdog(config: SyncConfig): SyncWatchdog {
  const { db, provider, router, renewThresholdDays } = config;
  const notifier: NotifierDispatcher = config.notifier ?? createNoopDispatcher();
  const hookRunner = createHookRunner();
  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  async function fireHooks(mapping: PortMapping, payload: HookPayloadBase): Promise<void> {
    await fireHooksForMapping(db, hookRunner, mapping.id, payload);
  }

  async function checkProviderSync(): Promise<void> {
    const providerPorts = await provider.listPorts();
    const portSet = new Set(providerPorts.map((p) => p.port));
    const nowSeconds = Math.floor(Date.now() / 1000);

    const mappings = db.listMappings().filter((m) => m.status !== "expired");

    for (const mapping of mappings) {
      if (portSet.has(mapping.vpnPort)) continue;

      if (mapping.expiresAt <= nowSeconds) {
        db.updateMapping(mapping.id, { status: "expired" });

        try { await router.deletePortForward(mapping.routerHandle as RouterHandle); } catch {}

        await fireHooks(mapping, {
          mappingId: mapping.id,
          label: mapping.label,
          oldPort: mapping.vpnPort,
          newPort: null,
          destIp: mapping.destIp,
          destPort: mapping.destPort,
        });

        db.logSync("expired", mapping.id, {
          reason: "port_expired",
          vpnPort: mapping.vpnPort,
        });

        notifier.emit({
          category: "port.expired",
          severity: "warning",
          title: "VPN port expired",
          message: `Port ${mapping.vpnPort} on "${mapping.label}" has expired and was removed from the router.`,
          mappingId: mapping.id,
          data: { vpnPort: mapping.vpnPort },
        });
        continue;
      }

      const oldPort = mapping.vpnPort;
      try {
        const newProviderPort = await provider.createPort();
        const newPort = newProviderPort.port;
        const newExpiresAt = newProviderPort.expiresAt;

        db.updateMapping(mapping.id, {
          vpnPort: newPort,
          expiresAt: newExpiresAt,
          status: "active",
        });

        const updated = db.getMapping(mapping.id)!;
        try {
          const handle = await router.updatePortForward(
            updated.routerHandle as RouterHandle,
            specFromMapping(updated)
          );
          db.updateMapping(mapping.id, { routerHandle: handle });
        } catch {
          // router update best-effort; next tick runs repair
        }

        await fireHooks(mapping, {
          mappingId: mapping.id,
          label: mapping.label,
          oldPort,
          newPort,
          destIp: mapping.destIp,
          destPort: mapping.destPort,
        });

        db.logSync("recreate", mapping.id, {
          reason: "port_missing_from_provider",
          oldPort,
          newPort,
          newExpiresAt,
        });

        notifier.emit({
          category: "port.recreated",
          severity: "info",
          title: "VPN port recreated",
          message: `"${mapping.label}" port changed from ${oldPort} to ${newPort}.`,
          mappingId: mapping.id,
          data: { oldPort, newPort, newExpiresAt },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        db.updateMapping(mapping.id, { status: "error" });
        db.logSync("error", mapping.id, {
          reason: "port_recreate_failed",
          vpnPort: oldPort,
          error: message,
        });

        notifier.emit({
          category: "port.recreate_failed",
          severity: "error",
          title: "VPN port recreate failed",
          message: `"${mapping.label}" (port ${oldPort}) missing from provider; recreate attempt failed: ${message}`,
          mappingId: mapping.id,
          data: { vpnPort: oldPort, error: message },
        });
      }
    }
  }

  async function checkRenewals(): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const thresholdSeconds = renewThresholdDays * 86400;

    const mappings = db.listMappings().filter((m) => m.status === "active");

    for (const mapping of mappings) {
      if (mapping.expiresAt - nowSeconds <= thresholdSeconds) {
        const oldPort = mapping.vpnPort;

        try { await provider.deletePort(oldPort); } catch {}

        const newProviderPort = await provider.createPort();
        const newPort = newProviderPort.port;
        const newExpiresAt = newProviderPort.expiresAt;

        db.updateMapping(mapping.id, {
          vpnPort: newPort,
          expiresAt: newExpiresAt,
        });

        if (newPort !== oldPort) {
          const updated = db.getMapping(mapping.id)!;
          try {
            const handle = await router.updatePortForward(
              updated.routerHandle as RouterHandle,
              specFromMapping(updated)
            );
            db.updateMapping(mapping.id, { routerHandle: handle });
          } catch {
            // best-effort
          }
        }

        await fireHooks(mapping, {
          mappingId: mapping.id,
          label: mapping.label,
          oldPort,
          newPort,
          destIp: mapping.destIp,
          destPort: mapping.destPort,
        });

        db.logSync("renew", mapping.id, {
          oldPort,
          newPort,
          newExpiresAt,
        });

        notifier.emit({
          category: "port.renewed",
          severity: "info",
          title: "VPN port renewed",
          message: newPort === oldPort
            ? `"${mapping.label}" renewed; port ${newPort} kept.`
            : `"${mapping.label}" renewed; port changed from ${oldPort} to ${newPort}.`,
          mappingId: mapping.id,
          data: { oldPort, newPort, newExpiresAt },
        });
      }
    }
  }

  async function checkRouterRules(): Promise<void> {
    const mappings = db.listMappings().filter((m) => m.status === "active");
    for (const mapping of mappings) {
      try {
        const handleBefore = mapping.routerHandle as RouterHandle;
        const handleAfter = await router.repairPortForward(handleBefore, specFromMapping(mapping));
        if (JSON.stringify(handleBefore) !== JSON.stringify(handleAfter)) {
          db.updateMapping(mapping.id, { routerHandle: handleAfter });
          db.logSync("sync_fix", mapping.id, {
            reason: "router_rule_repaired",
            before: handleBefore,
            after: handleAfter,
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        db.logSync("error", mapping.id, {
          step: "router_repair",
          error: message,
        });

        notifier.emit({
          category: "router.repair_failed",
          severity: "error",
          title: "Router rule repair failed",
          message: `Could not repair router rules for "${mapping.label}": ${message}`,
          mappingId: mapping.id,
          data: { error: message },
        });
      }
    }
  }

  async function retryFailedHooks(): Promise<void> {
    const mappings = db.listMappings().filter((m) => m.status === "active");

    for (const mapping of mappings) {
      const hooks = db.listHooks(mapping.id);
      const failedHooks = hooks.filter((h) => h.lastStatus === "error");

      if (failedHooks.length === 0) continue;

      const payload: HookPayload = await buildHookPayload({
        mappingId: mapping.id,
        label: mapping.label,
        oldPort: null,
        newPort: mapping.vpnPort,
        destIp: mapping.destIp,
        destPort: mapping.destPort,
      });

      for (const hook of failedHooks) {
        try {
          const result = await hookRunner.execute(
            { type: hook.type, config: hook.config },
            payload
          );
          db.updateHookStatus(hook.id, result.success ? "ok" : "error", result.error);
          db.logSync("hook_retry", mapping.id, {
            hookId: hook.id,
            status: result.success ? "ok" : "error",
            error: result.error ?? null,
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          db.updateHookStatus(hook.id, "error", message);
          db.logSync("hook_retry", mapping.id, {
            hookId: hook.id,
            status: "error",
            error: message,
          });
        }
      }
    }
  }

  return {
    async runOnce(): Promise<void> {
      try {
        await router.login();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[sync] Router login failed: ${message}`);
        db.logSync("error", null, { step: "login", error: message });
        notifier.emit({
          category: "provider.login_failed",
          severity: "error",
          title: "Router login failed",
          message: `Sync watchdog could not log in to the router: ${message}`,
          data: { error: message },
        });
        return;
      }

      await checkProviderSync();
      await checkRenewals();
      await checkRouterRules();
      await retryFailedHooks();
    },

    start(intervalMs: number): void {
      intervalHandle = setInterval(() => {
        this.runOnce().catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[sync] runOnce error: ${message}`);
        });
      }, intervalMs);
    },

    stop(): void {
      if (intervalHandle !== null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    },
  };
}
