import type { VpnProvider, ProviderPort } from "../types.js";

const BASE_URL = "https://api.azirevpn.com/v3/portforwardings";

async function apiRequest(
  url: string,
  options: RequestInit
): Promise<unknown> {
  const res = await fetch(url, options);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // ignore parse errors
    }
    throw new Error(`Azire API error (${res.status}): ${message}`);
  }
  return res.json();
}

export function createAzireProvider(config: {
  apiToken: string;
  internalIp: string;
}): VpnProvider {
  const { apiToken, internalIp } = config;

  const authHeaders = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  return {
    name: "azire",
    maxPorts: 5,

    async listPorts(): Promise<ProviderPort[]> {
      const url = `${BASE_URL}?internal_ipv4=${encodeURIComponent(internalIp)}`;
      const data = (await apiRequest(url, {
        method: "GET",
        headers: authHeaders,
      })) as { data: { ports: Array<{ port: number; hidden: boolean; expires_at: number }> } };
      return data.data.ports.map((p) => ({
        port: p.port,
        expiresAt: p.expires_at,
      }));
    },

    async createPort(opts?: { expiresInDays?: number }): Promise<ProviderPort> {
      const data = (await apiRequest(BASE_URL, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          internal_ipv4: internalIp,
          hidden: false,
          expires_in: opts?.expiresInDays ?? 365,
        }),
      })) as { data: { port: number; expires_at: number } };
      return {
        port: data.data.port,
        expiresAt: data.data.expires_at,
      };
    },

    async deletePort(port: number): Promise<void> {
      await apiRequest(BASE_URL, {
        method: "DELETE",
        headers: authHeaders,
        body: JSON.stringify({
          internal_ipv4: internalIp,
          port,
        }),
      });
    },

    async checkPort(port: number): Promise<boolean> {
      try {
        await apiRequest(`${BASE_URL}/check/${port}`, {
          method: "GET",
          headers: authHeaders,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}
