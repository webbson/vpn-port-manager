export interface UnifiCreds {
  host: string;
  username: string;
  password: string;
}

export interface DiscoveredInterface {
  id: string;
  name: string;
  purpose?: string;
  zoneId: string | null;
}

export interface DiscoveredZone {
  id: string;
  name: string;
  key: string | null;
}

export interface DiscoveryResult {
  interfaces: DiscoveredInterface[];
  zones: DiscoveredZone[];
}

interface RawNetwork {
  _id: string;
  name?: string;
  purpose?: string;
  firewall_zone_id?: string;
  vpn_type?: string;
}

interface RawZone {
  _id: string;
  name?: string;
  zone_key?: string | null;
}

function isErrorLike(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function discoverUnifi(creds: UnifiCreds): Promise<DiscoveryResult> {
  const v1Base = `${creds.host}/proxy/network/api/s/default`;
  const v2Base = `${creds.host}/proxy/network/v2/api/site/default`;

  let cookie = "";
  let csrfToken = "";

  const loginRes = await fetch(`${creds.host}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: creds.username, password: creds.password }),
  });
  if (!loginRes.ok) {
    throw new Error(`UniFi login failed (${loginRes.status}): ${loginRes.statusText}`);
  }
  const setCookie = loginRes.headers.get("set-cookie");
  if (setCookie) {
    const match = setCookie.match(/TOKEN=([^;]+)/);
    cookie = match ? `TOKEN=${match[1]}` : setCookie.split(";")[0];
  }
  csrfToken =
    loginRes.headers.get("x-updated-csrf-token") ??
    loginRes.headers.get("x-csrf-token") ??
    "";

  async function get(url: string): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    };
    const res = await fetch(url, { headers });
    if (!res.ok) {
      let detail = "";
      try {
        const raw = await res.clone().text();
        if (raw) detail = ` — ${raw.slice(0, 300)}`;
      } catch { /* ignore */ }
      throw new Error(`GET ${url} failed (${res.status} ${res.statusText})${detail}`);
    }
    return res.json();
  }

  let interfaces: DiscoveredInterface[] = [];
  let zones: DiscoveredZone[] = [];

  try {
    const body = (await get(`${v1Base}/rest/networkconf`)) as { data?: RawNetwork[] };
    const rows = body.data ?? [];
    interfaces = rows.map((r) => ({
      id: r._id,
      name: r.name ?? r._id,
      purpose: r.purpose,
      zoneId: r.firewall_zone_id ?? null,
    }));
  } catch (err) {
    throw new Error(`Could not list interfaces: ${isErrorLike(err)}`);
  }

  try {
    const rows = (await get(`${v2Base}/firewall/zone`)) as RawZone[];
    zones = rows.map((r) => ({
      id: r._id,
      name: r.name ?? r._id,
      key: r.zone_key ?? null,
    }));
  } catch (err) {
    throw new Error(`Could not list firewall zones: ${isErrorLike(err)}`);
  }

  return { interfaces, zones };
}
