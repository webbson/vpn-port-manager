import type {
  PortForwardSpec,
  RouterClient,
  RouterHandle,
  RouterSettings,
  RouterTestResult,
} from "../types.js";
import type { DnatRule, FirewallRule } from "./types.js";

const RULE_INDEX = 20000;
const FW_RULESET = "WAN_IN";

interface UnifiHandle extends RouterHandle {
  dnatId: string | null;
  firewallId: string | null;
}

function toUnifiHandle(h: RouterHandle): UnifiHandle {
  return {
    dnatId: (h.dnatId as string | null | undefined) ?? null,
    firewallId: (h.firewallId as string | null | undefined) ?? null,
  };
}

function dnatRuleFor(spec: PortForwardSpec, vpnInterface: string): Omit<DnatRule, "_id"> {
  return {
    name: `VPM: ${spec.label}`,
    enabled: true,
    pfwd_interface: vpnInterface,
    src: "any",
    dst_port: String(spec.vpnPort),
    fwd: spec.destIp,
    fwd_port: String(spec.destPort),
    proto: spec.protocol,
    log: false,
  };
}

function firewallRuleFor(spec: PortForwardSpec): Omit<FirewallRule, "_id"> {
  return {
    name: `VPM: Allow ${spec.label}`,
    enabled: true,
    ruleset: FW_RULESET,
    rule_index: RULE_INDEX,
    action: "accept",
    protocol: spec.protocol,
    src_firewallgroup_ids: [],
    dst_address: spec.destIp,
    dst_port: String(spec.destPort),
    logging: false,
  };
}

export function createUnifiRouter(settings: RouterSettings): RouterClient {
  const apiBase = `${settings.host}/proxy/network/api/s/default`;
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
            const parsed = JSON.parse(raw) as { meta?: { msg?: string; rc?: string } };
            const msg = parsed.meta?.msg;
            detail = msg ? ` — ${msg}` : ` — ${raw.slice(0, 500)}`;
          } catch {
            detail = ` — ${raw.slice(0, 500)}`;
          }
        }
      } catch {
        /* ignore body read failure */
      }
      throw new Error(
        `UniFi API error (${res.status} ${res.statusText}) on ${opts.method ?? "GET"} ${path}${detail}`
      );
    }
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

  async function createDnatRule(rule: Omit<DnatRule, "_id">): Promise<string> {
    const body = (await request("/rest/nat", {
      method: "POST",
      body: JSON.stringify(rule),
    })) as { data: DnatRule[] };
    return body.data[0]._id!;
  }

  async function updateDnatRule(id: string, rule: Partial<DnatRule>): Promise<void> {
    await request(`/rest/nat/${id}`, {
      method: "PUT",
      body: JSON.stringify(rule),
    });
  }

  async function deleteDnatRule(id: string): Promise<void> {
    await request(`/rest/nat/${id}`, { method: "DELETE" });
  }

  async function getDnatRule(id: string): Promise<DnatRule | null> {
    const body = (await request(`/rest/nat/${id}`)) as { data: DnatRule[] } | null;
    if (!body) return null;
    return body.data[0] ?? null;
  }

  async function createFirewallRule(rule: Omit<FirewallRule, "_id">): Promise<string> {
    const body = (await request("/rest/firewallrule", {
      method: "POST",
      body: JSON.stringify(rule),
    })) as { data: FirewallRule[] };
    return body.data[0]._id!;
  }

  async function updateFirewallRule(id: string, rule: Partial<FirewallRule>): Promise<void> {
    await request(`/rest/firewallrule/${id}`, {
      method: "PUT",
      body: JSON.stringify(rule),
    });
  }

  async function deleteFirewallRule(id: string): Promise<void> {
    await request(`/rest/firewallrule/${id}`, { method: "DELETE" });
  }

  async function getFirewallRule(id: string): Promise<FirewallRule | null> {
    const body = (await request(`/rest/firewallrule/${id}`)) as {
      data: FirewallRule[];
    } | null;
    if (!body) return null;
    return body.data[0] ?? null;
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
      const dnatId = await createDnatRule(dnatRuleFor(spec, settings.vpnInterface));
      const firewallId = await createFirewallRule(firewallRuleFor(spec));
      return { dnatId, firewallId } satisfies UnifiHandle;
    },

    async updatePortForward(handle: RouterHandle, spec: PortForwardSpec): Promise<RouterHandle> {
      const h = toUnifiHandle(handle);
      await login();
      if (h.dnatId) {
        await updateDnatRule(h.dnatId, {
          dst_port: String(spec.vpnPort),
          fwd: spec.destIp,
          fwd_port: String(spec.destPort),
          proto: spec.protocol,
        });
      }
      if (h.firewallId) {
        await updateFirewallRule(h.firewallId, {
          dst_address: spec.destIp,
          dst_port: String(spec.destPort),
          protocol: spec.protocol,
        });
      }
      return h;
    },

    async deletePortForward(handle: RouterHandle): Promise<void> {
      const h = toUnifiHandle(handle);
      try { await login(); } catch { /* best effort */ }
      if (h.dnatId) {
        try { await deleteDnatRule(h.dnatId); } catch { /* best effort */ }
      }
      if (h.firewallId) {
        try { await deleteFirewallRule(h.firewallId); } catch { /* best effort */ }
      }
    },

    async repairPortForward(handle: RouterHandle, spec: PortForwardSpec): Promise<RouterHandle> {
      const h = toUnifiHandle(handle);
      let dnatId = h.dnatId;
      let firewallId = h.firewallId;

      if (!dnatId || (await getDnatRule(dnatId)) === null) {
        dnatId = await createDnatRule(dnatRuleFor(spec, settings.vpnInterface));
      }
      if (!firewallId || (await getFirewallRule(firewallId)) === null) {
        firewallId = await createFirewallRule(firewallRuleFor(spec));
      }
      return { dnatId, firewallId } satisfies UnifiHandle;
    },
  };
}
