import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { createProvider } from "./providers/index.js";
import { createUnifiClient } from "./unifi/client.js";
import { createSyncWatchdog } from "./sync.js";
import { createApiRoutes } from "./routes/api.js";
import { createUiRoutes } from "./routes/ui.js";

const config = loadConfig();

const db = createDb(process.env.DB_PATH ?? "/data/vpnportmanager.db");

const provider = createProvider(config);

const unifi = createUnifiClient({
  host: config.unifiHost,
  username: config.unifiUsername,
  password: config.unifiPassword,
  vpnInterface: config.unifiVpnInterface,
});

const app = new Hono();

app.route(
  "/api",
  createApiRoutes({
    db,
    provider,
    unifi,
    vpnInterface: config.unifiVpnInterface,
    maxPorts: config.maxPorts,
  })
);

app.route(
  "/",
  createUiRoutes({
    db,
    provider,
    unifi,
    vpnInterface: config.unifiVpnInterface,
  })
);

const watchdog = createSyncWatchdog({
  db,
  provider,
  unifi,
  renewThresholdDays: config.renewThresholdDays,
});

// Run initial sync
watchdog.runOnce().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[startup] Initial sync failed: ${message}`);
});

// Start periodic sync
watchdog.start(config.syncIntervalMs);

console.log(`VPN Port Manager starting`);
console.log(`  Port:          ${config.port}`);
console.log(`  Provider:      ${config.vpnProvider} (max ${config.maxPorts} ports)`);
console.log(`  UniFi host:    ${config.unifiHost}`);
console.log(`  Sync interval: ${config.syncIntervalMs}ms`);

serve(
  { fetch: app.fetch, port: config.port },
  (info) => {
    console.log(`Listening on http://localhost:${info.port}`);
  }
);

function shutdown(): void {
  console.log("Shutting down…");
  watchdog.stop();
  db.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
