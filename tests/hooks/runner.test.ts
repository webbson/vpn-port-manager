import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHookRunner } from "../../src/hooks/runner.js";
import type { HookPayload } from "../../src/hooks/types.js";

const payload: HookPayload = {
  mappingId: "abc-123",
  label: "Plex",
  oldPort: 58216,
  newPort: 59000,
  destIp: "10.0.17.249",
  destPort: 32400,
};

describe("HookRunner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("executes a webhook hook with correct URL, method, and body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    vi.stubGlobal("fetch", mockFetch);

    const runner = createHookRunner();
    const result = await runner.execute(
      {
        type: "webhook",
        config: JSON.stringify({ url: "https://example.com/hook", method: "POST" }),
      },
      payload,
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/hook");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual(payload);
  });

  it("sends custom headers on top of Content-Type: application/json", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    vi.stubGlobal("fetch", mockFetch);

    const runner = createHookRunner();
    const result = await runner.execute(
      {
        type: "webhook",
        config: JSON.stringify({
          url: "https://example.com/hook",
          method: "POST",
          headers: { Authorization: "Bearer abc", "X-Trace": "t1" },
        }),
      },
      payload,
    );

    expect(result.success).toBe(true);
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(options.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer abc",
      "X-Trace": "t1",
    });
  });

  it("returns error for webhook failure (500)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    vi.stubGlobal("fetch", mockFetch);

    const runner = createHookRunner();
    const result = await runner.execute(
      {
        type: "webhook",
        config: JSON.stringify({ url: "https://example.com/hook" }),
      },
      payload,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
  });

  it("returns error for unknown plugin", async () => {
    const runner = createHookRunner();
    const result = await runner.execute(
      {
        type: "plugin",
        config: JSON.stringify({ plugin: "nonexistent" }),
      },
      payload,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unknown plugin: nonexistent");
  });
});
