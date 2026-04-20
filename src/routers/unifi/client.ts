import type {
  PortForwardSpec,
  RouterClient,
  RouterHandle,
  RouterTestResult,
} from "../types.js";
import type { UnifiRouterSettings } from "./schema.js";

interface UnifiHandle extends RouterHandle {
  natId: string | null;
  firewallId: string | null;
}

function toUnifiHandle(h: RouterHandle): UnifiHandle {
  return {
    natId: (h.natId as string | null | undefined) ?? null,
    firewallId: (h.firewallId as string | null | undefined) ?? null,
  };
}

type NatType = "DNAT";

interface NatRule {
  _id?: string;
  enabled: boolean;
  rule_index: number;
  is_predefined: boolean;
  description: string;
  type: NatType;
  ip_version: "IPV4";
  in_interface: string;
  protocol: string;
  port: string;
  source_filter: { filter_type: "NONE" };
  destination_filter: {
    filter_type: "ADDRESS_AND_PORT";
    port: string;
    invert_port: boolean;
  };
  ip_address: string;
  setting_preference: "manual";
  logging: boolean;
  exclude: boolean;
  pppoe_use_base_interface: boolean;
}

interface FirewallPolicy {
  _id?: string;
  name: string;
  description: string;
  enabled: boolean;
  action: "ALLOW";
  create_allow_respond: boolean;
  ip_version: "IPV4";
  logging: boolean;
  protocol: string;
  connection_state_type: "ALL";
  match_ip_sec: boolean;
  schedule: { mode: "ALWAYS" };
  source: {
    zone_id: string;
    match_mac: boolean;
    port_matching_type: "ANY";
    matching_target: "ANY";
  };
  destination: {
    zone_id: string;
    port_matching_type: "SPECIFIC";
    port: string;
    match_opposite_ports: boolean;
    matching_target: "IP";
    matching_target_type: "SPECIFIC";
    ips: string[];
    match_opposite_ips: boolean;
  };
}

function natRuleFor(spec: PortForwardSpec, inInterfaceId: string): Omit<NatRule, "_id"> {
  return {
    enabled: true,
    rule_index: 0,
    is_predefined: false,
    description: `VPM: ${spec.label}`,
    type: "DNAT",
    ip_version: "IPV4",
    in_interface: inInterfaceId,
    protocol: spec.protocol,
    port: String(spec.destPort),
    source_filter: { filter_type: "NONE" },
    destination_filter: {
      filter_type: "ADDRESS_AND_PORT",
      port: String(spec.vpnPort),
      invert_port: false,
    },
    ip_address: spec.destIp,
    setting_preference: "manual",
    logging: false,
    exclude: false,
    pppoe_use_base_interface: false,
  };
}

function firewallPolicyFor(
  spec: PortForwardSpec,
  sourceZoneId: string,
  destinationZoneId: string
): Omit<FirewallPolicy, "_id"> {
  return {
    name: `VPM: ${spec.label}`,
    description: "",
    enabled: true,
    action: "ALLOW",
    create_allow_respond: true,
    ip_version: "IPV4",
    logging: false,
    protocol: spec.protocol,
    connection_state_type: "ALL",
    match_ip_sec: false,
    schedule: { mode: "ALWAYS" },
    source: {
      zone_id: sourceZoneId,
      match_mac: false,
      port_matching_type: "ANY",
      matching_target: "ANY",
    },
    destination: {
      zone_id: destinationZoneId,
      port_matching_type: "SPECIFIC",
      port: String(spec.destPort),
      match_opposite_ports: false,
      matching_target: "IP",
      matching_target_type: "SPECIFIC",
      ips: [spec.destIp],
      match_opposite_ips: false,
    },
  };
}

export function createUnifiRouter(settings: UnifiRouterSettings): RouterClient {
  const apiBase = `${settings.host}/proxy/network/v2/api/site/default`;
  let cookie = "";
  let csrfToken = "";

  function captureCsrf(res: Response): void {
    const updated = res.headers.get("x-updated-csrf-token") ?? res.headers.get("x-csrf-token");
    if (updated) csrfToken = updated;
  }

  async function request(path: string, opts: RequestInit = {}): Promise<unknown> {
    const url = `${apiBase}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(opts.headers as Record<string, string> | undefined),
    };
    const res = await fetch(url, { ...opts, headers });
    captureCsrf(res);
    if (res.status === 404) return null;
    if (!res.ok) {
      let detail = "";
      try {
        const raw = await res.clone().text();
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as { meta?: { msg?: string }; errorCode?: string; message?: string };
            detail = parsed.meta?.msg ?? parsed.message ?? parsed.errorCode ?? raw.slice(0, 500);
            detail = ` — ${detail}`;
          } catch {
            detail = ` — ${raw.slice(0, 500)}`;
          }
        }
      } catch {
        /* ignore */
      }
      throw new Error(
        `UniFi API error (${res.status} ${res.statusText}) on ${opts.method ?? "GET"} ${path}${detail}`
      );
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function login(): Promise<void> {
    const res = await fetch(`${settings.host}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: settings.username,
        password: settings.password,
      }),
    });
    if (!res.ok) {
      throw new Error(`UniFi login failed (${res.status}): ${res.statusText}`);
    }
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const match = setCookie.match(/TOKEN=([^;]+)/);
      cookie = match ? `TOKEN=${match[1]}` : setCookie.split(";")[0];
    }
    captureCsrf(res);
  }

  async function createNat(spec: PortForwardSpec): Promise<string> {
    const body = (await request("/nat", {
      method: "POST",
      body: JSON.stringify(natRuleFor(spec, settings.inInterfaceId)),
    })) as NatRule;
    if (!body._id) throw new Error("UniFi created a NAT rule but returned no _id");
    return body._id;
  }

  async function updateNat(id: string, spec: PortForwardSpec): Promise<void> {
    const payload: NatRule = { ...natRuleFor(spec, settings.inInterfaceId), _id: id };
    await request(`/nat/${id}`, { method: "PUT", body: JSON.stringify(payload) });
  }

  async function deleteNat(id: string): Promise<void> {
    await request(`/nat/${id}`, { method: "DELETE" });
  }

  async function getNat(id: string): Promise<NatRule | null> {
    const body = (await request(`/nat/${id}`)) as NatRule | null;
    return body;
  }

  async function createFirewall(spec: PortForwardSpec): Promise<string> {
    const body = (await request("/firewall-policies", {
      method: "POST",
      body: JSON.stringify(firewallPolicyFor(spec, settings.sourceZoneId, settings.destinationZoneId)),
    })) as FirewallPolicy;
    if (!body._id) throw new Error("UniFi created a firewall policy but returned no _id");
    return body._id;
  }

  async function updateFirewall(id: string, spec: PortForwardSpec): Promise<void> {
    const payload: FirewallPolicy = {
      ...firewallPolicyFor(spec, settings.sourceZoneId, settings.destinationZoneId),
      _id: id,
    };
    await request(`/firewall-policies/${id}`, { method: "PUT", body: JSON.stringify(payload) });
  }

  async function deleteFirewall(id: string): Promise<void> {
    await request(`/firewall-policies/batch-delete`, {
      method: "POST",
      body: JSON.stringify([id]),
    });
  }

  async function getFirewall(id: string): Promise<FirewallPolicy | null> {
    const body = (await request(`/firewall-policies/${id}`)) as FirewallPolicy | null;
    return body;
  }

  return {
    name: "unifi",

    login,

    async testConnection(): Promise<RouterTestResult> {
      try {
        await login();
        return { ok: true };
      } catch (err: unknown) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async ensurePortForward(spec: PortForwardSpec): Promise<RouterHandle> {
      await login();
      const natId = await createNat(spec);
      let firewallId: string | null = null;
      try {
        firewallId = await createFirewall(spec);
      } catch (err) {
        // If firewall creation fails, roll back the NAT rule so we don't leak it
        try { await deleteNat(natId); } catch { /* best effort */ }
        throw err;
      }
      return { natId, firewallId } satisfies UnifiHandle;
    },

    async updatePortForward(handle: RouterHandle, spec: PortForwardSpec): Promise<RouterHandle> {
      const h = toUnifiHandle(handle);
      await login();
      if (h.natId) await updateNat(h.natId, spec);
      if (h.firewallId) await updateFirewall(h.firewallId, spec);
      return h;
    },

    async deletePortForward(handle: RouterHandle): Promise<void> {
      const h = toUnifiHandle(handle);
      try { await login(); } catch { /* best effort */ }
      if (h.natId) {
        try { await deleteNat(h.natId); } catch { /* best effort */ }
      }
      if (h.firewallId) {
        try { await deleteFirewall(h.firewallId); } catch { /* best effort */ }
      }
    },

    async repairPortForward(handle: RouterHandle, spec: PortForwardSpec): Promise<RouterHandle> {
      const h = toUnifiHandle(handle);
      await login();
      let natId = h.natId;
      let firewallId = h.firewallId;

      if (!natId || (await getNat(natId)) === null) {
        natId = await createNat(spec);
      }
      if (!firewallId || (await getFirewall(firewallId)) === null) {
        firewallId = await createFirewall(spec);
      }
      return { natId, firewallId } satisfies UnifiHandle;
    },
  };
}
