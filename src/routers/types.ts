export type Protocol = "tcp" | "udp" | "tcp_udp";

export interface PortForwardSpec {
  vpnPort: number;
  destIp: string;
  destPort: number;
  protocol: Protocol;
  label: string;
}

export type RouterHandle = Record<string, string | number | null>;

export interface RouterTestResult {
  ok: boolean;
  error?: string;
}

export interface RouterClient {
  name: string;
  login(): Promise<void>;
  testConnection(): Promise<RouterTestResult>;
  ensurePortForward(spec: PortForwardSpec): Promise<RouterHandle>;
  updatePortForward(handle: RouterHandle, spec: PortForwardSpec): Promise<RouterHandle>;
  deletePortForward(handle: RouterHandle): Promise<void>;
  repairPortForward(handle: RouterHandle, spec: PortForwardSpec): Promise<RouterHandle>;
}

export interface RouterSettings {
  type: "unifi";
  host: string;
  username: string;
  password: string;
  // UniFi v2 NAT/firewall are keyed by internal IDs, not interface names.
  // Grab these from the UniFi UI (DevTools → Network tab) while creating
  // a test rule, or the /setup wizard has a Discover button.
  inInterfaceId: string;      // NAT: in_interface (VPN interface ID)
  sourceZoneId: string;       // Firewall: source.zone_id  (e.g. External/VPN zone)
  destinationZoneId: string;  // Firewall: destination.zone_id (e.g. Internal/LAN zone)
}
