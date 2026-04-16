# VPN Port Manager

A Docker-based control interface for managing VPN port forwardings and automatically configuring UniFi Dream Machine Pro network rules. Request ports from your VPN provider, bind them to LAN destinations via DNAT/firewall rules, and trigger post-step hooks when ports change.

## Features

- **VPN port management** — Request, renew, and release port forwardings from VPN providers (Azire VPN supported)
- **UniFi integration** — Automatically creates and manages DNAT and firewall rules on UDM-Pro
- **Post-step hooks** — Notify services when ports change via built-in plugins (Plex), webhooks, or shell commands
- **Self-healing sync** — Background watchdog detects drift, re-creates lost ports after provider restarts, auto-renews before expiry, and retries failed hooks
- **Web UI** — Simple dashboard for viewing status, creating mappings, and managing hooks

## How It Works

```
┌─────────────┐     ┌──────────┐     ┌───────────┐     ┌───────────┐
│ VPN Provider│────▶│ Port     │────▶│ UniFi     │────▶│ Hooks     │
│ (Azire)     │     │ Manager  │     │ DMP       │     │ (Plex...) │
└─────────────┘     └──────────┘     └───────────┘     └───────────┘
      ▲                  │
      │    ┌─────────────┘
      │    ▼
      │  ┌──────────┐
      └──│ Sync     │  ← runs every 5 min
         │ Watchdog │    detects drift, renews, retries
         └──────────┘
```

1. You create a port mapping in the web UI (label, destination IP:port, protocol)
2. The manager requests a port from your VPN provider
3. It creates a DNAT rule and firewall policy on your UDM-Pro
4. Any configured hooks fire (e.g., update Plex's advertised port)
5. The sync watchdog keeps everything in sync automatically

## Prerequisites

- A WireGuard VPN connection already configured on your UDM-Pro
- The container must run on a network/IP that routes through the VPN tunnel (the Azire API requires VPN connectivity)
- A dedicated UniFi local account for API access

## Quick Start

```bash
git clone https://github.com/webbson/unifi-wireguard-vpn-portmanager.git
cd unifi-wireguard-vpn-portmanager
cp .env.example .env
# Edit .env with your credentials
docker compose up -d
```

Open `http://<container-ip>:3000` in your browser.

## Configuration

All configuration is via environment variables. See `.env.example` for the full list.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VPN_PROVIDER` | yes | — | Provider name (`azire`) |
| `VPN_API_TOKEN` | yes | — | Bearer token for the VPN provider API |
| `VPN_INTERNAL_IP` | yes | — | Your internal VPN IP (e.g., `10.0.16.181`) |
| `MAX_PORTS` | no | `5` | Maximum port forwardings allowed |
| `UNIFI_HOST` | yes | — | UDM-Pro address (e.g., `https://192.168.1.1`) |
| `UNIFI_USERNAME` | yes | — | UniFi local account username |
| `UNIFI_PASSWORD` | yes | — | UniFi local account password |
| `UNIFI_VPN_INTERFACE` | yes | — | WireGuard interface name on UDM-Pro (e.g., `wg0`) |
| `SYNC_INTERVAL_MS` | no | `300000` | Sync watchdog interval (default 5 min) |
| `RENEW_THRESHOLD_DAYS` | no | `30` | Days before expiry to auto-renew |
| `PORT` | no | `3000` | Web UI listen port |

## Hooks

Each port mapping can have hooks that fire when the port changes (creation, renewal, loss, deletion).

### Plex Plugin

Automatically updates Plex's manually specified port when the VPN port changes.

Config: `plugin: plex`, `host: http://<plex-ip>:32400`, `token: <plex-token>`

### Webhook

POSTs a JSON payload with port change details to any URL.

Config: `url: http://example.com/hook`, `method: POST`

### Command

Runs a shell command inside the container with template variable substitution.

Config: `command: /scripts/update.sh {{newPort}} {{destIp}}`

Available variables: `{{mappingId}}`, `{{label}}`, `{{oldPort}}`, `{{newPort}}`, `{{destIp}}`, `{{destPort}}`

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/mappings` | List all port mappings |
| `POST` | `/api/mappings` | Create a new mapping |
| `PUT` | `/api/mappings/:id` | Update a mapping |
| `DELETE` | `/api/mappings/:id` | Delete a mapping |
| `POST` | `/api/mappings/:id/refresh` | Force re-sync a mapping |
| `GET` | `/api/status` | System health check |
| `GET` | `/api/logs` | Recent sync log entries |

## Sync Watchdog Behavior

The watchdog runs periodically and handles:

- **Lost ports** — If the VPN provider restarts and ports disappear, the watchdog requests new ports and updates all downstream rules and hooks automatically
- **Expiring ports** — Ports approaching their expiry date are renewed before they lapse
- **Missing UniFi rules** — If DNAT or firewall rules disappear (e.g., firmware update), they're re-created
- **Failed hooks** — Hooks that errored on the last run are retried

## Unraid

See [`unraid/README.md`](unraid/README.md) for Unraid-specific installation instructions and the Docker template.

## Development

```bash
pnpm install
pnpm dev          # dev server with hot reload
pnpm test         # run tests
pnpm build        # compile TypeScript
```

## Tech Stack

TypeScript, Hono, better-sqlite3, Node.js 22
