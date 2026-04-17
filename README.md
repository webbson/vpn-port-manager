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
git clone https://github.com/webbson/vpn-port-manager.git
cd vpn-port-manager
cp .env.example .env
# Generate a random APP_SECRET_KEY and put it in .env:
openssl rand -hex 32
docker compose up -d
```

Open `http://<container-ip>:3000` in your browser and complete the setup wizard — enter VPN provider and router credentials in the UI. After saving, restart the container to start the service fully.

Docker Hub image: `webbson/vpn-port-manager` (private during early testing, multi-arch amd64 + arm64). Run `docker login` with a Docker Hub token once before `docker compose pull` / `up`.

## Configuration

All provider + router credentials are configured in the web UI (Settings page) and stored encrypted in the SQLite database. The only env vars the app reads are:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APP_SECRET_KEY` | **yes** | — | 16+ char key used to encrypt stored VPN/router secrets. Generate with `openssl rand -hex 32`. **Do not change after first boot** — rotating invalidates every stored secret. |
| `PORT` | no | `3000` | Web UI + API listen port |
| `DB_PATH` | no | `/data/vpnportmanager.db` | SQLite file path |

Operational knobs (sync interval, renew threshold, max ports) are set on the Settings page — **App** section.

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
