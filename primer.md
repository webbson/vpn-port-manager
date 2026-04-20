# VPN Port Manager

## What This Is

Docker-based web UI that manages VPN port forwardings (Azire first), maps them to DNAT + firewall-policies on a UniFi UDM-Pro, and fires post-change hooks. Config lives in the DB (AES-256-GCM for secrets); only `APP_SECRET_KEY`, `PORT`, `DB_PATH` come from env.

## Current State

- 17 source files in `src/`, 14 test files, **91 passing tests**, clean tsc.
- Provider + router layers modularised (`providers/<id>/`, `routers/<id>/` with registries).
- UDM-Pro v2 NAT + firewall-policies API in use; handle stored as JSON in `port_mappings.router_handle`.
- Hot-reloadable settings: VPN, router, and app settings all apply without a container restart.

## Architecture

Five layers: Provider → State (SQLite) → Router → Hook, with Settings encrypted in the DB. Runtime registry (`src/runtime.ts`) holds the current provider/router/watchdog behind accessors so routes pick up reloads on every request.

## Key Files

- `src/index.ts` — entry; middleware gates non-settings paths when runtime isn't ready.
- `src/runtime.ts` — live provider/router/watchdog + `reloadVpn/reloadRouter/reloadApp`.
- `src/settings.ts` — encrypted settings service, fresh reads per call.
- `src/services/dangling-ports.ts` — `provider.listPorts() − db mappings`.
- `src/routes/api.ts` — REST API; adds `GET /api/ports/dangling` and `POST /api/ports/dangling/:port/release`.
- `src/routes/ui.ts` — UI routes; dashboard computes dangling list; `/create?adopt=<port>` reuses an existing provider port.
- `src/views/dashboard.ts` — "Dangling Ports" section + click-to-copy VPN port (`externalIp:port`).
- `src/views/layout.ts` — global click handler for `.port-copy`; banner now shows only on reload failure.

## What Changed This Session

1. **Hot-reload settings** — introduced `Runtime` registry; every `PUT /api/settings/*` returns `restartRequired: false` and the restart banner appears only if a live reload throws (with `reloadError` surfaced to the UI).
2. **Dangling ports** — dashboard surfaces provider ports with no DB mapping; "Release" calls `provider.deletePort`, "Adopt" routes to `/create?adopt=<port>` which reuses the existing VPN port instead of creating a new one.
3. **Click-to-copy** — VPN port cells in the mapping table are buttons that copy `externalIp:port` on click (falls back to `document.execCommand('copy')` when `navigator.clipboard` is unavailable).

Plan: `~/.claude/plans/1-can-we-make-hazy-key.md`.

## Next Steps

- Manual verification against a real Azire + UDM-Pro: test adopt/release flow and hot-reload of each settings section.
- Add a second VPN provider / router to exercise the registry's `z.discriminatedUnion` switch noted in `CLAUDE.md`.

## Open Blockers

None.
