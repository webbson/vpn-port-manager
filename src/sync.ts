import type { Db } from "./db.js";
import type { VpnProvider } from "./providers/types.js";
import type { UnifiClient } from "./unifi/types.js";
import { createHookRunner } from "./hooks/runner.js";
import type { HookPayload } from "./hooks/types.js";
import type { PortMapping } from "./db.js";

export interface SyncConfig {
  db: Db;
  provider: VpnProvider;
  unifi: UnifiClient;
  renewThresholdDays: number;
}

export interface SyncWatchdog {
  runOnce(): Promise<void>;
  start(intervalMs: number): void;
  stop(): void;
}

export function createSyncWatchdog(config: SyncConfig): SyncWatchdog {
  const { db, provider, unifi, renewThresholdDays } = config;
  const hookRunner = createHookRunner();
  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  async function fireHooks(mapping: PortMapping, payload: HookPayload): Promise<void> {
    const hooks = db.listHooks(mapping.id);
    for (const hook of hooks) {
      try {
        const result = await hookRunner.execute({ type: hook.type, config: hook.config }, payload);
        db.updateHookStatus(hook.id, result.success ? "ok" : "error", result.error);
        db.logSync("hook_fire", mapping.id, {
          hookId: hook.id,
          type: hook.type,
          status: result.success ? "ok" : "error",
          error: result.error ?? null,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        db.updateHookStatus(hook.id, "error", message);
        db.logSync("hook_fire", mapping.id, {
          hookId: hook.id,
          type: hook.type,
          status: "error",
          error: message,
        });
      }
    }
  }

  async function checkProviderSync(): Promise<void> {
    const providerPorts = await provider.listPorts();
    const portSet = new Set(providerPorts.map((p) => p.port));

    const mappings = db.listMappings().filter((m) => m.status !== "expired");

    for (const mapping of mappings) {
      if (!portSet.has(mapping.vpnPort)) {
        // Port is gone from provider — mark expired and clean up
        db.updateMapping(mapping.id, { status: "expired" });

        if (mapping.unifiDnatId) {
          try {
            await unifi.deleteDnatRule(mapping.unifiDnatId);
          } catch {
            // ignore — rule may already be gone
          }
        }

        if (mapping.unifiFirewallId) {
          try {
            await unifi.deleteFirewallRule(mapping.unifiFirewallId);
          } catch {
            // ignore
          }
        }

        const payload: HookPayload = {
          mappingId: mapping.id,
          label: mapping.label,
          oldPort: mapping.vpnPort,
          newPort: null,
          destIp: mapping.destIp,
          destPort: mapping.destPort,
        };
        await fireHooks(mapping, payload);

        db.logSync("sync_fix", mapping.id, {
          reason: "port_missing_from_provider",
          vpnPort: mapping.vpnPort,
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

        // Delete old port from provider
        try {
          await provider.deletePort(oldPort);
        } catch {
          // ignore — may already be gone
        }

        // Create new port
        const newProviderPort = await provider.createPort();
        const newPort = newProviderPort.port;
        const newExpiresAt = newProviderPort.expiresAt;

        db.updateMapping(mapping.id, {
          vpnPort: newPort,
          expiresAt: newExpiresAt,
        });

        // Update UniFi rules if port number changed
        if (newPort !== oldPort) {
          if (mapping.unifiDnatId) {
            try {
              await unifi.updateDnatRule(mapping.unifiDnatId, {
                dst_port: String(newPort),
              });
            } catch {
              // best effort
            }
          }

          if (mapping.unifiFirewallId) {
            try {
              await unifi.updateFirewallRule(mapping.unifiFirewallId, {
                dst_port: String(newPort),
              });
            } catch {
              // best effort
            }
          }
        }

        const payload: HookPayload = {
          mappingId: mapping.id,
          label: mapping.label,
          oldPort,
          newPort,
          destIp: mapping.destIp,
          destPort: mapping.destPort,
        };
        await fireHooks(mapping, payload);

        db.logSync("renew", mapping.id, {
          oldPort,
          newPort,
          newExpiresAt,
        });
      }
    }
  }

  async function checkUnifiRules(): Promise<void> {
    const mappings = db.listMappings().filter((m) => m.status === "active");

    for (const mapping of mappings) {
      // Check DNAT rule
      if (mapping.unifiDnatId) {
        const dnatRule = await unifi.getDnatRule(mapping.unifiDnatId);
        if (dnatRule === null) {
          // Re-create DNAT rule
          const newDnatId = await unifi.createDnatRule({
            name: `vpn-portfwd-${mapping.label}`,
            enabled: true,
            pfwd_interface: "wan",
            src: "any",
            dst_port: String(mapping.vpnPort),
            fwd: mapping.destIp,
            fwd_port: String(mapping.destPort),
            proto: mapping.protocol === "both" ? "tcp_udp" : mapping.protocol,
            log: false,
          });

          db.updateMapping(mapping.id, { unifiDnatId: newDnatId });
          db.logSync("sync_fix", mapping.id, {
            reason: "dnat_rule_missing",
            oldId: mapping.unifiDnatId,
            newId: newDnatId,
          });
        }
      }

      // Re-fetch mapping in case DNAT update changed it
      const refreshed = db.getMapping(mapping.id);
      const fwId = refreshed?.unifiFirewallId ?? mapping.unifiFirewallId;

      if (fwId) {
        const fwRule = await unifi.getFirewallRule(fwId);
        if (fwRule === null) {
          // Re-create firewall rule
          const newFwId = await unifi.createFirewallRule({
            name: `vpn-allow-${mapping.label}`,
            enabled: true,
            ruleset: "WAN_IN",
            rule_index: 2000,
            action: "accept",
            protocol: mapping.protocol === "both" ? "tcp_udp" : mapping.protocol,
            src_firewallgroup_ids: [],
            dst_address: mapping.destIp,
            dst_port: String(mapping.vpnPort),
            logging: false,
          });

          db.updateMapping(mapping.id, { unifiFirewallId: newFwId });
          db.logSync("sync_fix", mapping.id, {
            reason: "firewall_rule_missing",
            oldId: fwId,
            newId: newFwId,
          });
        }
      }
    }
  }

  async function retryFailedHooks(): Promise<void> {
    const mappings = db.listMappings().filter((m) => m.status === "active");

    for (const mapping of mappings) {
      const hooks = db.listHooks(mapping.id);
      const failedHooks = hooks.filter((h) => h.lastStatus === "error");

      if (failedHooks.length === 0) continue;

      const payload: HookPayload = {
        mappingId: mapping.id,
        label: mapping.label,
        oldPort: null,
        newPort: mapping.vpnPort,
        destIp: mapping.destIp,
        destPort: mapping.destPort,
      };

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
      // Step 1: Login to UniFi
      try {
        await unifi.login();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[sync] UniFi login failed: ${message}`);
        db.logSync("error", null, { step: "login", error: message });
        return;
      }

      // Step 2: Check provider sync (detect ports missing from provider)
      await checkProviderSync();

      // Step 3: Renew ports expiring soon
      await checkRenewals();

      // Step 4: Re-create missing UniFi rules
      await checkUnifiRules();

      // Step 5: Retry failed hooks
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
