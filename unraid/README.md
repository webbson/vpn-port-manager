# Unraid Installation

The XML template is served publicly from this GitHub repo, so Unraid can load it via URL. The Docker Hub image (`webbson/vpn-port-manager`) is **private** while the project is in early testing, so Unraid also needs to authenticate to Docker Hub once before it can pull.

Provider + router credentials are **not** set as env vars. After the container starts, the web UI shows a setup wizard where VPN and router details are entered and stored encrypted in the app's SQLite database.

## Prerequisites

- The container must run on a network/IP that routes through your VPN tunnel
- Your UDM-Pro WireGuard VPN client connection must already be configured
- A dedicated UniFi local account for API access
- A Docker Hub account with access to the private `webbson/vpn-port-manager` repo

## 1. Authenticate Unraid to Docker Hub (one-time)

On the Unraid console:

```bash
docker login -u <your-dockerhub-username>
# paste a Docker Hub Personal Access Token with at least Read scope
```

Credentials persist in `/root/.docker/config.json` across reboots.

## 2. Generate an APP_SECRET_KEY

On any machine:

```bash
openssl rand -hex 32
```

Copy the result. This key encrypts every secret stored in the app (VPN API token, router password). Keep it safe — rotating it later invalidates every saved setting.

## 3. Add the container in the Unraid UI

- **Docker → Add Container**
- Paste this into the **Template** field:

  ```
  https://raw.githubusercontent.com/webbson/vpn-port-manager/main/unraid/vpn-port-manager.xml
  ```

- Fill in **App Secret Key** with the value from step 2. Leave **Web UI Port** and **AppData** at their defaults.
- Set the network to `br0` (or your VPN-routed network) and assign a static IP.
- Click **Apply**. Unraid will pull `webbson/vpn-port-manager:latest` using the credentials from step 1.

## 4. Complete the setup wizard

Open the container's Web UI. You will land on `/setup` automatically. Enter:

- **VPN provider** — Azire API token + internal VPN IP.
- **Router** — UDM-Pro URL, admin username, admin password, and the VPN interface name (usually `wg0`).

Use the **Test** button next to each section to verify connectivity before saving. After saving both sections, **restart the container** (Docker tab → click the icon → Restart) to exit setup mode and start the sync watchdog.

## Changing settings later

Edit on the **Settings** page and save. A yellow banner appears telling you to restart the container — save takes effect only after the next boot.

## Permissions

The container runs as the `node` user (uid 1000). On first start, the appdata path (`/mnt/user/appdata/vpn-port-manager`) must be writable by that uid. If the container fails to start with a permission error:

```bash
chown -R 1000:1000 /mnt/user/appdata/vpn-port-manager
```

## Network Setup

The container needs an IP that routes through your VPN:

- **br0 with static IP** — assign a LAN IP, then use Unraid's network routing or a VLAN to route that IP through the VPN tunnel
- **Custom Docker network** — create a macvlan or ipvlan network attached to your VPN interface

The container itself does NOT run a VPN client — it expects the network layer to handle routing.

## Updating

Use Unraid's built-in **Check for Updates** — it re-pulls the `:latest` tag with the stored Docker Hub credentials. GitHub Actions rebuilds and pushes a new `:latest` on every `v*.*.*` tag.

## Data

The SQLite database at `/mnt/user/appdata/vpn-port-manager/vpnportmanager.db` stores:

- Port mappings, hooks, and sync log (plaintext — not sensitive).
- Encrypted VPN + router settings (AES-GCM wrapped with `APP_SECRET_KEY`).

Back this up if you want to preserve mappings, hook configs, and saved settings. If you lose the `APP_SECRET_KEY`, the settings rows become unrecoverable; port mappings and hooks stay readable.

## Build locally instead (optional)

```bash
cd /mnt/user/appdata
git clone https://github.com/webbson/vpn-port-manager.git vpn-port-manager-src
cd vpn-port-manager-src
docker build -t webbson/vpn-port-manager:latest .
```

Then install via the template URL above — it will reuse the local image.
