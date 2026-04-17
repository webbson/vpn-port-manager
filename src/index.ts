import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { createSettingsService } from "./settings.js";
import { createProvider } from "./providers/index.js";
import { createRouter } from "./routers/index.js";
import { createSyncWatchdog } from "./sync.js";
import { createApiRoutes } from "./routes/api.js";
import { createUiRoutes } from "./routes/ui.js";
import { createSettingsRoutes } from "./routes/settings.js";
import { layout } from "./views/layout.js";
import { setupView } from "./views/setup.js";
import { settingsView } from "./views/settings.js";

const config = loadConfig();
const db = createDb(config.dbPath);
const settings = createSettingsService(db, config.appSecretKey);

const app = new Hono();

// Settings API is always mounted so the UI can configure a fresh install.
app.route("/api/settings", createSettingsRoutes({ settings }));

app.get("/settings", (c) => {
  return c.html(
    layout(
      "Settings",
      settingsView({
        vpn: settings.getVpn(),
        router: settings.getRouter(),
        app: settings.getApp(),
      })
    )
  );
});

app.get("/setup", (c) => c.html(layout("Setup", setupView())));

let watchdog: ReturnType<typeof createSyncWatchdog> | null = null;

if (settings.isConfigured()) {
  const vpn = settings.getVpn()!;
  const routerSettings = settings.getRouter()!;
  const appSettings = settings.getApp();

  const provider = createProvider(vpn);
  const router = createRouter(routerSettings);
  const effectiveMaxPorts = appSettings.maxPorts ?? provider.maxPorts;

  app.route(
    "/api",
    createApiRoutes({ db, provider, router, maxPorts: effectiveMaxPorts })
  );
  app.route("/", createUiRoutes({ db, provider, router }));

  watchdog = createSyncWatchdog({
    db,
    provider,
    router,
    renewThresholdDays: appSettings.renewThresholdDays,
  });

  watchdog.runOnce().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[startup] Initial sync failed: ${message}`);
  });

  watchdog.start(appSettings.syncIntervalMs);

  console.log("VPN Port Manager starting (configured)");
  console.log(`  Port:          ${config.port}`);
  console.log(`  Provider:      ${provider.name} (max ${effectiveMaxPorts} ports)`);
  console.log(`  Router:        ${router.name} @ ${routerSettings.host}`);
  console.log(`  Sync interval: ${appSettings.syncIntervalMs}ms`);
} else {
  app.get("/", (c) => c.redirect("/setup"));
  app.all("*", (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/api/settings") || path === "/setup" || path === "/settings") {
      return next();
    }
    return c.redirect("/setup");
  });

  console.log("VPN Port Manager starting (setup mode — not yet configured)");
  console.log(`  Port:          ${config.port}`);
  console.log(`  Open http://<host>:${config.port}/setup to configure.`);
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});

function shutdown(): void {
  console.log("Shutting down…");
  watchdog?.stop();
  db.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
