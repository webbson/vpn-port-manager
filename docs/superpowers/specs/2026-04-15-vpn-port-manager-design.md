# VPN Port Manager -- Design Spec

**Date:** 2026-04-15
**Status:** Approved

## Overview

A Docker-based management tool that requests port forwardings from VPN providers (starting with Azire VPN), creates corresponding DNAT and firewall rules on a UniFi Dream Machine Pro via its API, and executes post-step hooks (built-in plugins, webhooks, shell commands) when ports change. Exposes a simple web UI for status and management.

## Context

- The WireGuard VPN tunnel is already configured on the UDM-Pro
- The Docker container runs on a LAN IP that routes through the VPN tunnel
- The container can therefore talk directly to the Azire API (which requires VPN connectivity)
- UDM-Pro runs latest firmware with the newer UniFi OS API

## Architecture

Four layers with clear responsibilities:

### 1. Provider Layer

Abstracts VPN port forwarding APIs behind a common interface. Selected via `VPN_PROVIDER` env var.

```typescript
interface VpnProvider {
  name: string;
  maxPorts: number;
  listPorts(): Promise<ProviderPort[]>;
  createPort(opts?: { expiresInDays?: number }): Promise<ProviderPort>;
  deletePort(port: number): Promise<void>;
  checkPort(port: number): Promise<boolean>;
}

interface ProviderPort {
  port: number;
  expiresAt: number; // unix timestamp
}
```

**Azire VPN implementation:**
- Base URL: `https://api.azirevpn.com/v3/portforwardings`
- Auth: Bearer token via `VPN_API_TOKEN` env var
- All requests require `internal_ipv4` parameter (from `VPN_INTERNAL_IP` env var)
- Max 5 ports per connection
- Endpoints: GET (list), POST (create), DELETE (delete), GET /check/:port (verify)

Adding a new provider means implementing the `VpnProvider` interface and registering it in a provider map.

### 2. State Layer (SQLite)

SQLite is the source of truth. Every action writes intent to the DB first, then executes.

**`port_mappings`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (UUID) | Primary key |
| `provider` | TEXT | e.g., "azire" |
| `vpn_port` | INTEGER | Port assigned by VPN provider |
| `dest_ip` | TEXT | LAN target IP |
| `dest_port` | INTEGER | LAN target port |
| `protocol` | TEXT | "tcp", "udp", or "both" |
| `label` | TEXT | Human-friendly name (e.g., "Plex") |
| `status` | TEXT | "active", "pending", "error", "expired" |
| `expires_at` | INTEGER | Unix timestamp from provider |
| `unifi_dnat_id` | TEXT | UniFi DNAT rule ID for cleanup |
| `unifi_firewall_id` | TEXT | UniFi firewall policy ID for cleanup |
| `created_at` | INTEGER | Timestamp |
| `updated_at` | INTEGER | Timestamp |

**`hooks`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT (UUID) | Primary key |
| `mapping_id` | TEXT | FK to port_mappings |
| `type` | TEXT | "plugin", "webhook", "command" |
| `config` | TEXT (JSON) | Type-specific configuration |
| `last_run_at` | INTEGER | Timestamp |
| `last_status` | TEXT | "success", "error" |
| `last_error` | TEXT | Error message if failed |

**`sync_log`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment |
| `timestamp` | INTEGER | When it happened |
| `action` | TEXT | "create", "delete", "renew", "sync_fix", "hook_fired" |
| `mapping_id` | TEXT | Related mapping |
| `details` | TEXT (JSON) | What changed |

### 3. UniFi Layer

Manages DNAT rules, firewall policies on the UDM-Pro.

**Auth flow:**
- Login via `POST /api/auth/login` with username/password
- Store session cookie, refresh before expiry
- Handle self-signed certificates (skip TLS verification for UDM-Pro)

**On mapping create:**
1. Create DNAT rule via `/proxy/network/api/s/default/rest/nat` -- routes traffic arriving on VPN interface at the assigned port to LAN dest_ip:dest_port
2. Create firewall policy via `/proxy/network/api/s/default/rest/firewallrule` -- allows External→Internal traffic for that destination IP and port
3. Store both rule IDs in the `port_mappings` row

**On port change (renewal assigns new port):**
- Update the DNAT rule's source port to the new VPN port
- Update the firewall rule if port is referenced
- Fire all attached hooks with old and new port numbers

**On mapping delete:**
- Delete DNAT rule and firewall policy by stored ID
- Delete the port on the VPN provider
- Fire hooks with `newPort: null`

### 4. Hook Layer

Executes post-step actions when a port mapping changes. Each hook receives:

```typescript
interface HookPayload {
  mappingId: string;
  label: string;
  oldPort: number | null;
  newPort: number | null;
  destIp: string;
  destPort: number;
}
```

**Three hook types:**

**Plugin (built-in):**
Config example: `{ "plugin": "plex", "host": "http://<plex-ip>:32400", "token": "<plex-token>" }`
Ships with a Plex plugin that updates the manually specified port via the Plex API. New plugins = new code.

**Webhook:**
Config example: `{ "url": "http://some-service/hook", "method": "POST", "headers": {} }`
POSTs the `HookPayload` to the configured URL.

**Command:**
Config example: `{ "command": "/scripts/update-port.sh {{newPort}}" }`
Runs inside the container. Template variables (`{{newPort}}`, `{{oldPort}}`, `{{destIp}}`, `{{destPort}}`, `{{label}}`) are substituted before execution.

## Action Flow (Hybrid: Immediate + Sync Watchdog)

**User-initiated actions** execute immediately for fast feedback:
1. User clicks "Create mapping" in web UI
2. API handler requests port from Azire
3. Stores mapping in DB with status "pending"
4. Creates UniFi DNAT + firewall rules
5. Fires attached hooks
6. Updates status to "active" and returns result

If any step fails, the DB records partial state and the sync watchdog picks it up.

**Sync watchdog** runs every `SYNC_INTERVAL_MS` (default 5 min):
1. **Provider check** -- Lists ports from Azire, compares against DB. If a port disappeared, marks mapping and cascades deletion through UniFi + hooks.
2. **Renewal check** -- Mappings expiring within `RENEW_THRESHOLD_DAYS` get auto-renewed. If the new port number differs, cascades update through UniFi rules and hooks.
3. **UniFi verification** -- Confirms DNAT and firewall rules still exist by stored IDs. Re-creates if missing (e.g., after firmware update).
4. **Hook retry** -- Retries any hooks with `last_status: "error"`.

Each action is logged to `sync_log`.

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/mappings` | List all port mappings with hooks and status |
| `POST` | `/api/mappings` | Create new mapping |
| `PUT` | `/api/mappings/:id` | Update destination or hooks |
| `DELETE` | `/api/mappings/:id` | Remove mapping |
| `POST` | `/api/mappings/:id/refresh` | Force re-sync a single mapping |
| `GET` | `/api/status` | System health: provider connectivity, UniFi connection, sync state |
| `GET` | `/api/logs` | Recent sync log entries |

The web UI consumes these same endpoints.

## Web UI

Server-rendered HTML with minimal JavaScript. No framework. Pages:

- **Dashboard** -- Overview of all port mappings with status indicators, expiry dates, and quick actions (delete, refresh). Shows system health (provider connected, UniFi connected, last sync time).
- **Create mapping** -- Form: label, destination IP, destination port, protocol. Optional hook configuration.
- **Edit mapping** -- Change destination, manage hooks.
- **Logs** -- Scrollable list of recent sync log entries.

No authentication -- accessed only on local network.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VPN_PROVIDER` | yes | -- | Provider to use ("azire") |
| `VPN_API_TOKEN` | yes | -- | Bearer token for the VPN provider API |
| `VPN_INTERNAL_IP` | yes | -- | Internal VPN IP (e.g., 10.0.16.181) |
| `MAX_PORTS` | no | `5` | Max port forwardings allowed |
| `UNIFI_HOST` | yes | -- | UDM-Pro address (e.g., https://192.168.1.1) |
| `UNIFI_USERNAME` | yes | -- | UniFi local account username |
| `UNIFI_PASSWORD` | yes | -- | UniFi local account password |
| `UNIFI_VPN_INTERFACE` | yes | -- | Name of the WireGuard VPN interface on UDM-Pro |
| `SYNC_INTERVAL_MS` | no | `300000` | Sync watchdog interval (default 5 min) |
| `RENEW_THRESHOLD_DAYS` | no | `30` | Days before expiry to auto-renew |
| `PORT` | no | `3000` | Web UI listen port |

## Tech Stack

- **Runtime:** Node.js (slim Docker image)
- **Language:** TypeScript
- **Web framework:** Hono
- **Database:** SQLite via better-sqlite3
- **Frontend:** Server-rendered HTML with minimal vanilla JS
- **Containerization:** Docker with multi-stage build

## Docker

```dockerfile
# Multi-stage build
# Stage 1: Build TypeScript
# Stage 2: Slim Node.js runtime with only production deps
```

Volumes:
- `/data` -- SQLite database file (persist across container restarts)

## Testing Strategy

- Unit tests for provider interface, hook execution, template substitution
- Integration tests for UniFi API layer (mocked HTTP)
- End-to-end tests for the sync watchdog logic
- Manual verification of UniFi rules via the web UI

## Future Considerations

- Additional VPN providers (AirVPN, Mullvad, etc.)
- More built-in hook plugins
- Port health checking (verify the port is actually reachable from the internet)
- Notification system (email, push) for sync errors or expiring ports
