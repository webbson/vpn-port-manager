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
docker compose up -d   # Run in Docker (reads .env for secrets)
```

## Architecture

Four-layer system that manages VPN port forwardings and creates corresponding network rules on a UniFi Dream Machine Pro:

```
Provider Layer → State Layer (SQLite) → UniFi Layer → Hook Layer
   (Azire)         (source of truth)     (DNAT+FW)    (Plex, webhooks, commands)
```

**Hybrid action model:** User actions (create/delete/update mapping) execute immediately through the API. A sync watchdog runs on a timer as a safety net — it detects drift, auto-renews expiring ports, re-creates missing UniFi rules, and retries failed hooks.

### Provider Layer (`src/providers/`)
`VpnProvider` interface in `types.ts`. Implementations registered in `index.ts` via switch on `VPN_PROVIDER` env var. Currently only Azire VPN (`azire.ts`). The container must run on an IP that routes through the VPN tunnel — Azire API requires VPN connectivity.

### State Layer (`src/db.ts`)
SQLite via better-sqlite3. Three tables: `port_mappings`, `hooks`, `sync_log`. All DB types use camelCase in TypeScript, snake_case in SQL, with row mapper functions converting between them. The `Db` interface is the single export — all queries go through it.

### UniFi Layer (`src/unifi/`)
Cookie-based auth against the UDM-Pro API (`/proxy/network/api/s/default/rest/...`). Creates DNAT rules (`/rest/nat`) and firewall policies (`/rest/firewallrule`). Stores rule IDs in `port_mappings` for clean updates and deletion. TLS verification disabled for self-signed UDM-Pro certs.

### Hook Layer (`src/hooks/`)
Three hook types, all receiving `HookPayload` with old/new port info:
- **Plugin:** Built-in integrations (Plex in `plugins/plex.ts`). Register new plugins in the `plugins` map in `runner.ts`.
- **Webhook:** HTTP POST to a URL with the payload as JSON.
- **Command:** Shell execution with `{{variable}}` template substitution.

### Sync Watchdog (`src/sync.ts`)
Periodic background job: provider sync check → renewal check → UniFi rule verification → failed hook retry. Interval controlled by `SYNC_INTERVAL_MS`.

### Web Layer (`src/routes/`, `src/views/`)
Hono framework. REST API at `/api/*` consumed by the server-rendered HTML UI at `/`. Views are plain TypeScript functions returning HTML strings — no frontend framework.

## Key Patterns

- **Factory functions everywhere:** `createDb()`, `createProvider()`, `createUnifiClient()`, `createHookRunner()`, `createSyncWatchdog()`, `createApiRoutes()`, `createUiRoutes()`. All accept config/dependencies and return an interface. This makes testing with mocks straightforward.
- **ES modules:** `"type": "module"` in package.json. All imports must use `.js` extensions.
- **Config validation:** `src/config.ts` uses zod to parse and validate all env vars at startup. Add new env vars there.
- **Tests mock fetch globally:** `vi.stubGlobal("fetch", mockFetch)` is the pattern for testing HTTP clients (provider, UniFi, hooks). DB tests use `:memory:` SQLite.

## Adding a New VPN Provider

1. Create `src/providers/{name}.ts` implementing `VpnProvider` from `types.ts`
2. Add case to the switch in `src/providers/index.ts`
3. Add tests in `tests/providers/{name}.test.ts`

## Adding a New Hook Plugin

1. Create `src/hooks/plugins/{name}.ts` implementing `HookPlugin` from `types.ts`
2. Register in the `plugins` map in `src/hooks/runner.ts`
3. Add tests in `tests/hooks/plugins/{name}.test.ts`

## Environment Variables

See `.env.example` for all variables. Required: `VPN_PROVIDER`, `VPN_API_TOKEN`, `VPN_INTERNAL_IP`, `UNIFI_HOST`, `UNIFI_USERNAME`, `UNIFI_PASSWORD`, `UNIFI_VPN_INTERFACE`. DB path defaults to `/data/vpnportmanager.db` (override with `DB_PATH`).

## Design Docs

- Spec: `docs/superpowers/specs/2026-04-15-vpn-port-manager-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-15-vpn-port-manager.md`
