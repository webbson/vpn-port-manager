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
`SettingsService` wraps the `settings` table with encryption. `getVpn()` / `getRouter()` decrypt on read using the key derived from `APP_SECRET_KEY`; `setVpn` / `setRouter` encrypt on write. `getApp()` returns plain `AppSettings` (maxPorts, syncIntervalMs, renewThresholdDays) with sensible defaults. `isConfigured()` gates setup mode. Encryption lives in `src/crypto.ts` (AES-256-GCM, scrypt KDF, `v1:` versioned blob format).

### Hook Layer (`src/hooks/`)
Three hook types, all receiving `HookPayload` with old/new port info:
- **Plugin:** Built-in integrations (Plex in `plugins/plex.ts`). Register new plugins in the `plugins` map in `runner.ts`.
- **Webhook:** HTTP POST to a URL with the payload as JSON.
- **Command:** Shell execution with `{{variable}}` template substitution.

### Sync Watchdog (`src/sync.ts`)
Periodic background job: provider sync check → renewal check → router rule repair → failed hook retry. Interval is `AppSettings.syncIntervalMs` (stored in the `settings` table, default 5 min). Rule repair calls `router.repairPortForward(handle, spec)` which re-creates any missing underlying rules and returns a possibly-updated handle.

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
- **Save → restart:** every `PUT /api/settings/*` returns `{ ok: true, restartRequired: true }`. The UI flips a `localStorage.restartRequired` flag that the global layout uses to render a yellow banner; changes only take effect after a container restart.

## Adding a New VPN Provider

1. Create `src/providers/{name}.ts` implementing `VpnProvider` from `types.ts`.
2. Extend `VpnSettings.provider` union in `src/settings.ts` and add a case to the switch in `src/providers/index.ts`.
3. Add tests in `tests/providers/{name}.test.ts`.

## Adding a New Router

1. Create `src/routers/{name}/client.ts` implementing `RouterClient` from `../types.ts`. Define a handle shape containing the router-native identifiers and use `spec.vpnPort`/`destIp`/`destPort`/`protocol`/`label` to construct rules.
2. Extend `RouterSettings.type` union in `src/routers/types.ts` and add a case to the switch in `src/routers/index.ts`.
3. Extend `src/views/settings.ts` + `src/views/setup.ts` with the router-specific fields (or factor into sub-views).
4. Add tests in `tests/routers/{name}.test.ts`.

## Adding a New Hook Plugin

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
