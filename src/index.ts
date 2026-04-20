import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { createSettingsService } from "./settings.js";
import { createRuntime } from "./runtime.js";
import { createApiRoutes } from "./routes/api.js";
import { createUiRoutes } from "./routes/ui.js";
import { createSettingsRoutes } from "./routes/settings.js";
import { layout } from "./views/layout.js";
import { setupView } from "./views/setup.js";
import { settingsView } from "./views/settings.js";

const config = loadConfig();
const db = createDb(config.dbPath);
const settings = createSettingsService(db, config.appSecretKey);
const runtime = createRuntime({ db, settings });

const app = new Hono();

// Settings API + pages are always mounted so the UI works in setup mode.
app.route("/api/settings", createSettingsRoutes({ settings, runtime }));

app.get("/settings", (c) => {
  return c.html(
    layout(
      "Settings",
      settingsView({
        vpn: settings.getVpn(),
        router: settings.getRouter(),
        app: settings.getApp(),
        issues: settings.getIssues().messages,
      })
    )
  );
});

app.get("/setup", (c) =>
  c.html(layout("Setup", setupView({ issues: settings.getIssues().messages })))
);

// Gate the rest of the app: if VPN or router settings aren't usable, redirect
// non-settings traffic to /setup (HTML) or 503 (API) until config is entered.
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const isAlwaysOpen =
    path.startsWith("/api/settings") || path === "/settings" || path === "/setup";
  if (isAlwaysOpen) return next();
  if (!runtime.isReady()) {
    if (path.startsWith("/api/")) {
      return c.json({ error: "not configured" }, 503);
    }
    return c.redirect("/setup");
  }
  return next();
});

app.route("/api", createApiRoutes({ db, runtime }));
app.route("/", createUiRoutes({ db, runtime }));

if (runtime.isReady()) {
  const appSettings = settings.getApp();
  const provider = runtime.getProvider();
  const router = runtime.getRouter();
  const routerSettings = settings.getRouter()!;
  console.log("VPN Port Manager starting (configured)");
  console.log(`  Port:          ${config.port}`);
  console.log(`  Provider:      ${provider.name} (max ${runtime.getMaxPorts()} ports)`);
  console.log(`  Router:        ${router.name} @ ${routerSettings.host}`);
  console.log(`  Sync interval: ${appSettings.syncIntervalMinutes} min`);
} else {
  const issues = settings.getIssues();
  if (issues.messages.length > 0) {
    console.log("VPN Port Manager starting (setup mode — stored settings need re-entry)");
    for (const msg of issues.messages) console.log(`  ! ${msg}`);
  } else {
    console.log("VPN Port Manager starting (setup mode — not yet configured)");
  }
  console.log(`  Port:          ${config.port}`);
  console.log(`  Open http://<host>:${config.port}/setup to configure.`);
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});

function shutdown(): void {
  console.log("Shutting down…");
  runtime.stop();
  db.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
