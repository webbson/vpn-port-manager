# VPN Port Manager

## What This Is

Docker-based web UI that manages VPN port forwardings (Azire VPN first), creates corresponding DNAT and firewall rules on a UniFi Dream Machine Pro, and fires post-step hooks (Plex plugin, webhooks, shell commands) when ports change.

## Current State

**v1 implementation complete.** All 11 tasks from the implementation plan are done.

- 19 source files in `src/`
- 8 test files with 42 passing tests
- Clean TypeScript build
- Docker setup with multi-stage build + compose

## Architecture

Four layers: Provider (Azire VPN API) → State (SQLite) → UniFi (DNAT + firewall rules) → Hooks (plugins/webhooks/commands). Hybrid action model: user actions execute immediately, sync watchdog runs every 5 min as safety net.

## Key Files

- `src/index.ts` — entry point, wires everything together
- `src/config.ts` — env var parsing with zod
- `src/db.ts` — SQLite (better-sqlite3), all CRUD
- `src/providers/azire.ts` — Azire VPN port forwarding API client
- `src/unifi/client.ts` — UDM-Pro API (DNAT + firewall rules)
- `src/hooks/runner.ts` — hook executor (plugin/webhook/command)
- `src/sync.ts` — watchdog: renewal, drift detection, hook retry
- `src/routes/api.ts` — REST API (Hono)
- `src/routes/ui.ts` — server-rendered HTML routes
- `src/views/` — dashboard, create, edit, logs views

## What Changed This Session

- Designed and spec'd the entire project (brainstorming skill)
- Wrote implementation plan (11 tasks)
- Implemented all tasks using subagent-driven development
- All 42 tests pass, build clean

## Next Steps

- Test with real Azire VPN + UDM-Pro (manual integration testing)
- Verify UniFi API endpoints match actual firmware (may need adjustment)
- Build and deploy Docker container
- Add more VPN providers if needed
- Consider adding notifications for sync errors

## Open Blockers

None. Ready for integration testing.
