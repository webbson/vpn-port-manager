# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm test              # Run all tests (vitest)
pnpm vitest run tests/db.test.ts  # Run a single test file
pnpm test:watch        # Watch mode
pnpm build             # TypeScript compilation (tsc)
pnpm dev               # Dev server with hot reload (tsx watch)
pnpm start             # Production server (requires build first)
docker compose up -d   # Run in Docker (reads APP_SECRET_KEY from .env)
```

## Architecture

Five-layer system managing VPN port forwardings and the router rules that expose them on the LAN:

```
Provider Layer → State Layer (SQLite) → Router Layer → Hook Layer
   (Azire)         (source of truth)    (UniFi, …)    (Plex, webhooks, commands)
                         ▲
                   Settings Layer
             (encrypted in-app config)
```

**Hybrid action model:** User actions (create/delete/update mapping) execute immediately through the API. A sync watchdog runs on a timer as a safety net — it detects drift, auto-renews expiring ports, re-creates missing router rules, and retries failed hooks.

**Config lives in the DB, not env vars.** The only env vars the app reads are `APP_SECRET_KEY` (required), `PORT`, and `DB_PATH`. Everything else (VPN token, router credentials, sync interval, renew threshold, max ports) is entered through the web UI and stored — with AES-256-GCM for secret rows — in the `settings` table.

### Provider Layer (`src/providers/`)
`VpnProvider` interface in `types.ts`. Implementations registered in `index.ts` via switch on the `provider` field of the stored `VpnSettings`. Currently only Azire VPN (`azire.ts`). The container must run on an IP that routes through the VPN tunnel — Azire's API requires VPN connectivity.

### Router Layer (`src/routers/`)
`RouterClient` interface in `types.ts` — high-level port-forward primitives (`ensurePortForward`, `updatePortForward`, `deletePortForward`, `repairPortForward`, `testConnection`). Implementations in subdirectories (`src/routers/unifi/`). The UniFi impl hides UDM-Pro's DNAT + firewall rule pair behind a `{ dnatId, firewallId }` handle stored as JSON in `port_mappings.router_handle`. The factory in `index.ts` switches on `RouterSettings.type`.

### State Layer (`src/db.ts`)
SQLite via better-sqlite3. Four tables: `port_mappings`, `hooks`, `sync_log`, `settings`. All DB types use camelCase in TypeScript, snake_case in SQL, with row mapper functions converting between them. The `Db` interface is the single export. A migration step on boot moves any legacy `unifi_dnat_id` / `unifi_firewall_id` columns into the JSON `router_handle` column.

### Settings Layer (`src/settings.ts`)
`SettingsService` wraps the `settings` table with encryption. `getVpn()` / `getRouter()` decrypt on read using the key derived from `APP_SECRET_KEY`; `setVpn` / `setRouter` encrypt on write. `getApp()` returns plain `AppSettings` (maxPorts, syncIntervalMinutes, renewThresholdDays) with sensible defaults and migrates any legacy `syncIntervalMs` rows on read. `isConfigured()` gates setup mode. Encryption lives in `src/crypto.ts` (AES-256-GCM, scrypt KDF, `v1:` versioned blob format).

### Hook Layer (`src/hooks/`)
Two hook types, all receiving `HookPayload` with old/new port info:
- **Plugin:** Built-in integrations (Plex in `plugins/plex.ts`). Register new plugins in the `plugins` map in `runner.ts`.
- **Webhook:** HTTP request (POST/GET/PUT) to a URL with the payload as JSON and optional custom headers.

### Sync Watchdog (`src/sync.ts`)
Periodic background job: provider sync check → renewal check → router rule repair → failed hook retry. Interval is `AppSettings.syncIntervalMinutes` (stored in the `settings` table, default 15 min). Rule repair calls `router.repairPortForward(handle, spec)` which re-creates any missing underlying rules and returns a possibly-updated handle.

### Web Layer (`src/routes/`, `src/views/`)
Hono framework. REST API at `/api/*` (mappings, settings, status, logs) consumed by the server-rendered HTML UI at `/`. Views are plain TypeScript functions returning HTML strings — no frontend framework. Two routing modes in `src/index.ts`:
- **Configured:** full API + UI + sync watchdog.
- **Setup mode** (when `settings.isConfigured()` is false): only `/api/settings/*`, `/settings`, and `/setup` are mounted; everything else redirects to `/setup`.

## Key Patterns

- **Factory functions everywhere:** `createDb()`, `createSettingsService()`, `createProvider()`, `createRouter()`, `createHookRunner()`, `createSyncWatchdog()`, `createApiRoutes()`, `createUiRoutes()`, `createSettingsRoutes()`. All accept config/dependencies and return an interface.
- **ES modules:** `"type": "module"` in package.json. All imports must use `.js` extensions.
- **Config validation:** zod everywhere — env-var boundary (`src/config.ts`), API bodies (`src/routes/*.ts`), stored settings on decrypt (`src/settings.ts`).
- **Tests mock fetch globally:** `vi.stubGlobal("fetch", mockFetch)` is the pattern for HTTP-client tests. DB/settings tests use `:memory:` SQLite.
- **Secrets never leave the server** — `GET /api/settings/vpn` and `GET /api/settings/router` redact `apiToken` and `password`; see `tests/routes/settings.test.ts` for the assertion.
- **Hot-reloadable settings:** `PUT /api/settings/{vpn,router,app}` calls `runtime.reload*()` which rebuilds the provider/router and restarts the sync watchdog in place. Responses return `{ ok: true, restartRequired: false }` on success, or `{ ok: true, restartRequired: true, reloadError: "…" }` if the rebuild throws (bad creds, unreachable host). The yellow banner only shows on reload failure.
- **Runtime registry:** `src/runtime.ts` is the single holder of the live provider/router/watchdog. Routes receive the `Runtime` and call `getProvider()` / `getRouter()` per request — never capture these in closures.

## Adding a New VPN Provider

See [`docs/providers.md`](docs/providers.md) for the full walkthrough, contract, and verification steps. Quick reference:

Each provider is self-contained under `src/providers/{id}/`:

1. Create `src/providers/{id}/client.ts` — implement `VpnProvider` from `../types.ts`.
2. Create `src/providers/{id}/schema.ts` — zod schema with `provider: z.literal("{id}")`, the `Settings` type, and a `describeStored(s)` helper returning non-secret fields for `GET /api/settings/vpn`.
3. Create `src/providers/{id}/view.ts` — `renderFields(stored)` HTML fragment and a `readerScript` string that defines `read{Id}Form(opts)` in the browser.
4. Create `src/providers/{id}/index.ts` — export a `ProviderDefinition` wiring the above.
5. Register it in `src/providers/registry.ts` by adding it to `providerDefinitions`. Once two providers exist, switch `vpnSettingsSchema` to `z.discriminatedUnion("provider", [...])`.
6. Add tests in `tests/providers/{id}.test.ts` importing `src/providers/{id}/client.ts`.

No changes to views, routes, or the settings service are needed — they iterate the registry.

## Adding a New Router

See [`docs/routers.md`](docs/routers.md) for the full walkthrough, handle semantics, and the six-method `RouterClient` contract. Quick reference:

Each router is self-contained under `src/routers/{id}/`:

1. Create `src/routers/{id}/client.ts` — implement `RouterClient` from `../types.ts`. Define an opaque handle shape holding the router-native identifiers.
2. Create `src/routers/{id}/schema.ts` — zod schema with `type: z.literal("{id}")`, the `Settings` type, and `describeStored(s)`.
3. Create `src/routers/{id}/view.ts` — `renderFields(stored)` HTML fragment and a `readerScript` string defining `read{Id}Form(opts)` on the client. If the router supports discovery, also define a `discover{Id}()` function here that calls `POST /api/settings/router/discover` and populates the UI selects.
4. (Optional) Create `src/routers/{id}/discovery.ts` — function that logs into the router and returns the dropdown data. Referenced from the definition's `discover` property.
5. Create `src/routers/{id}/index.ts` — export a `RouterDefinition` wiring it all together.
6. Register it in `src/routers/registry.ts` by adding it to `routerDefinitions`. Once two routers exist, switch `routerSettingsSchema` to `z.discriminatedUnion("type", [...])`.
7. Add tests in `tests/routers/{id}.test.ts`.

## Adding a New Hook Plugin

See [`docs/hooks.md`](docs/hooks.md) for the full walkthrough, the three hook types, retry semantics, and security notes. Quick reference:

1. Create `src/hooks/plugins/{name}.ts` implementing `HookPlugin` from `types.ts`.
2. Register in the `plugins` map in `src/hooks/runner.ts`.
3. Add tests in `tests/hooks/plugins/{name}.test.ts`.

## Environment Variables

| Var | Required | Purpose |
|---|---|---|
| `APP_SECRET_KEY` | **yes** | 16+ char AES-GCM key for encrypting stored settings. Rotating invalidates all saved VPN/router credentials. |
| `PORT` | no (default 3000) | HTTP listen port |
| `DB_PATH` | no (default `/data/vpnportmanager.db`) | SQLite file path |

See `.env.example`. All other configuration lives in the web UI.

## Design Docs

- Spec: `docs/superpowers/specs/2026-04-15-vpn-port-manager-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-15-vpn-port-manager.md`
