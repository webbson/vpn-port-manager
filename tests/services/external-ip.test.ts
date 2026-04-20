import { describe, it, expect, vi, beforeEach } from "vitest";
import { getExternalIp, clearExternalIpCache } from "../../src/services/external-ip.js";

describe("getExternalIp", () => {
  beforeEach(() => {
    clearExternalIpCache();
    vi.unstubAllGlobals();
  });

  it("returns the IP from ipify on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ip: "203.0.113.42" }),
        } as unknown as Response)
      )
    );

    const result = await getExternalIp();
    expect(result.ip).toBe("203.0.113.42");
    expect(result.fetchedAt).toBeGreaterThan(0);
  });

  it("caches subsequent calls within the TTL window", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ip: "198.51.100.7" }),
      } as unknown as Response)
    );
    vi.stubGlobal("fetch", fetchSpy);

    await getExternalIp();
    await getExternalIp();
    await getExternalIp();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns null ip and an error message when the lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("tunnel down")))
    );

    const result = await getExternalIp();
    expect(result.ip).toBeNull();
    expect(result.error).toMatch(/tunnel down/);
  });
});
