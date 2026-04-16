import type { DnatRule, FirewallRule, UnifiClient } from "./types.js";

export function createUnifiClient(config: {
  host: string;
  username: string;
  password: string;
  vpnInterface: string;
}): UnifiClient {
  const apiBase = `${config.host}/proxy/network/api/s/default`;
  let cookie = "";

  async function request(
    path: string,
    opts: RequestInit = {}
  ): Promise<unknown> {
    const url = `${apiBase}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers as Record<string, string> | undefined),
    };

    const res = await fetch(url, { ...opts, headers });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      throw new Error(`UniFi API error (${res.status}): ${res.statusText}`);
    }

    return res.json();
  }

  return {
    async login(): Promise<void> {
      const res = await fetch(`${config.host}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: config.username,
          password: config.password,
        }),
      });

      if (!res.ok) {
        throw new Error(`UniFi login failed (${res.status}): ${res.statusText}`);
      }

      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        cookie = setCookie.split(";")[0];
      }
    },

    async createDnatRule(rule: Omit<DnatRule, "_id">): Promise<string> {
      const body = (await request("/rest/nat", {
        method: "POST",
        body: JSON.stringify(rule),
      })) as { data: DnatRule[] };
      return body.data[0]._id!;
    },

    async updateDnatRule(id: string, rule: Partial<DnatRule>): Promise<void> {
      await request(`/rest/nat/${id}`, {
        method: "PUT",
        body: JSON.stringify(rule),
      });
    },

    async deleteDnatRule(id: string): Promise<void> {
      await request(`/rest/nat/${id}`, { method: "DELETE" });
    },

    async getDnatRule(id: string): Promise<DnatRule | null> {
      const body = (await request(`/rest/nat/${id}`)) as {
        data: DnatRule[];
      } | null;
      if (!body) return null;
      return body.data[0] ?? null;
    },

    async createFirewallRule(
      rule: Omit<FirewallRule, "_id">
    ): Promise<string> {
      const body = (await request("/rest/firewallrule", {
        method: "POST",
        body: JSON.stringify(rule),
      })) as { data: FirewallRule[] };
      return body.data[0]._id!;
    },

    async updateFirewallRule(
      id: string,
      rule: Partial<FirewallRule>
    ): Promise<void> {
      await request(`/rest/firewallrule/${id}`, {
        method: "PUT",
        body: JSON.stringify(rule),
      });
    },

    async deleteFirewallRule(id: string): Promise<void> {
      await request(`/rest/firewallrule/${id}`, { method: "DELETE" });
    },

    async getFirewallRule(id: string): Promise<FirewallRule | null> {
      const body = (await request(`/rest/firewallrule/${id}`)) as {
        data: FirewallRule[];
      } | null;
      if (!body) return null;
      return body.data[0] ?? null;
    },
  };
}
