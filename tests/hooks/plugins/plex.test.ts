import { describe, it, expect, vi, beforeEach } from "vitest";
import { plexPlugin } from "../../../src/hooks/plugins/plex.js";
import type { HookPayload } from "../../../src/hooks/types.js";

const payload: HookPayload = {
  mappingId: "abc-123",
  label: "Plex",
  oldPort: 58216,
  newPort: 59000,
  destIp: "10.0.17.249",
  destPort: 32400,
};

const config = {
  token: "myplextoken",
};

describe("plexPlugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("updates Plex manual port with correct PUT URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await plexPlugin.execute(config, payload);

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://10.0.17.249:32400/:/prefs?ManualPortMappingPort=59000&X-Plex-Token=myplextoken",
    );
    expect(options.method).toBe("PUT");
  });

  it("skips fetch when newPort is null", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await plexPlugin.execute(config, { ...payload, newPort: null });

    expect(result.success).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns error on Plex API failure (401)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await plexPlugin.execute(config, payload);

    expect(result.success).toBe(false);
    expect(result.error).toContain("401");
    expect(result.error).toContain("Unauthorized");
  });
});
