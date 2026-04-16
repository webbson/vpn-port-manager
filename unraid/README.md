# Unraid Installation

## Prerequisites

- The container must run on a network/IP that routes through your VPN tunnel
- Your UDM-Pro WireGuard VPN client connection must already be configured

## Build & Install

1. **Copy the repo to your Unraid server:**

   ```bash
   cd /mnt/user/appdata
   git clone <repo-url> vpn-port-manager-src
   ```

2. **Build the Docker image:**

   ```bash
   cd /mnt/user/appdata/vpn-port-manager-src
   docker build -t vpn-port-manager .
   ```

3. **Add the template to Unraid:**

   ```bash
   cp unraid/vpn-port-manager.xml /boot/config/plugins/dockerMan/templates-user/my-vpn-port-manager.xml
   ```

4. **In the Unraid UI:**
   - Go to Docker → Add Container
   - Select "vpn-port-manager" from the template dropdown
   - Fill in your VPN and UniFi credentials
   - Set the network to `br0` (or your VPN-routed network) and assign a static IP
   - Click Apply

## Network Setup

The container needs an IP that routes through your VPN. Common approaches on Unraid:

- **br0 with static IP** — Assign the container a LAN IP, then use Unraid's network routing or a VLAN to route that IP through the VPN tunnel
- **Custom Docker network** — Create a macvlan or ipvlan network attached to your VPN interface

The container itself does NOT run a VPN client — it expects the network layer to handle routing.

## Updating

```bash
cd /mnt/user/appdata/vpn-port-manager-src
git pull
docker build -t vpn-port-manager .
docker restart vpn-port-manager
```

## Data

SQLite database is stored at `/mnt/user/appdata/vpn-port-manager/vpnportmanager.db`. Back this up if you want to preserve your port mappings and hook configs.
