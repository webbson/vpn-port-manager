# Unraid Installation

The XML template is served publicly from this GitHub repo, so Unraid can load it via URL. The Docker Hub image (`webbson/vpn-port-manager`) is **private** while the project is in early testing, so Unraid also needs to authenticate to Docker Hub once before it can pull.

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

Credentials are written to `/root/.docker/config.json` and persist across reboots. Unraid's Docker tab uses them for all subsequent pulls.

## 2. Add the container in the Unraid UI

- **Docker → Add Container**
- Paste this into the **Template** field:

  ```
  https://raw.githubusercontent.com/webbson/vpn-port-manager/main/unraid/vpn-port-manager.xml
  ```

- Fill in the required env vars: `VPN_API_TOKEN`, `VPN_INTERNAL_IP`, `UNIFI_HOST`, `UNIFI_USERNAME`, `UNIFI_PASSWORD`, `UNIFI_VPN_INTERFACE`
- Set the network to `br0` (or your VPN-routed network) and assign a static IP
- Click **Apply**

Unraid pulls `webbson/vpn-port-manager:latest` from the private repo using the credentials from step 1.

## Permissions

The container runs as the `node` user (uid 1000). On first start, the appdata path (`/mnt/user/appdata/vpn-port-manager`) must be writable by that uid. If the container fails to start with a permission error:

```bash
chown -R 1000:1000 /mnt/user/appdata/vpn-port-manager
```

## Network Setup

The container needs an IP that routes through your VPN:

- **br0 with static IP** — Assign a LAN IP, then use Unraid's network routing or a VLAN to route that IP through the VPN tunnel
- **Custom Docker network** — Create a macvlan or ipvlan network attached to your VPN interface

The container itself does NOT run a VPN client — it expects the network layer to handle routing.

## Updating

Use Unraid's built-in **Check for Updates** — it will re-pull the `:latest` tag using the stored Docker Hub credentials. Each pushed `v*.*.*` tag moves `:latest` via the GitHub Actions workflow.

## Data

SQLite database is stored at `/mnt/user/appdata/vpn-port-manager/vpnportmanager.db`. Back this up to preserve your port mappings and hook configs.

## Build locally instead (optional)

If you prefer building on the Unraid host instead of pulling from Docker Hub:

```bash
cd /mnt/user/appdata
git clone https://github.com/webbson/vpn-port-manager.git vpn-port-manager-src
cd vpn-port-manager-src
docker build -t webbson/vpn-port-manager:latest .
```

Then install via the template URL above — it will reuse the local image and skip the pull.
