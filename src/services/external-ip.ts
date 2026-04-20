const TTL_MS = 5 * 60_000;
let cached: { ip: string; at: number } | null = null;

export interface ExternalIpResult {
  ip: string | null;
  fetchedAt: number | null;
  error?: string;
}

export async function getExternalIp(): Promise<ExternalIpResult> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) {
    return { ip: cached.ip, fetchedAt: cached.at };
  }
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ip: null, fetchedAt: null, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { ip?: string };
    if (!data.ip) return { ip: null, fetchedAt: null, error: "no ip in response" };
    cached = { ip: data.ip, at: now };
    return { ip: data.ip, fetchedAt: now };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ip: null, fetchedAt: null, error: msg };
  }
}

export function clearExternalIpCache(): void {
  cached = null;
}
