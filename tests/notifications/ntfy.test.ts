import { describe, it, expect, vi, beforeEach } from "vitest";
import { createNtfyNotifier } from "../../src/notifications/ntfy/client.js";
import type { NtfySettings } from "../../src/notifications/ntfy/schema.js";

const baseSettings: NtfySettings = {
  provider: "ntfy",
  serverUrl: "https://ntfy.example.com",
  topic: "vpn-alerts",
};

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

describe("ntfy notifier", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to {serverUrl}/{topic} with title/priority/tag headers derived from severity", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", mockFetch);

    const notifier = createNtfyNotifier(baseSettings);
    await notifier.send({
      category: "port.renewed",
      severity: "info",
      title: "Port renewed",
      message: "body text",
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ntfy.example.com/vpn-alerts");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("body text");
    const headers = init.headers as Record<string, string>;
    expect(headers["Title"]).toBe("Port renewed");
    expect(headers["Priority"]).toBe("3");
    expect(headers["Tags"]).toContain("information_source");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("maps error severity to priority 5 and warning to 4", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", mockFetch);
    const notifier = createNtfyNotifier(baseSettings);

    await notifier.send({
      category: "router.repair_failed",
      severity: "error",
      title: "x",
      message: "y",
    });
    await notifier.send({
      category: "port.expired",
      severity: "warning",
      title: "x",
      message: "y",
    });

    const h0 = (mockFetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    const h1 = (mockFetch.mock.calls[1] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(h0["Priority"]).toBe("5");
    expect(h1["Priority"]).toBe("4");
  });

  it("sends Authorization header when bearerToken is configured", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", mockFetch);

    const notifier = createNtfyNotifier({ ...baseSettings, bearerToken: "tk_secret" });
    await notifier.send({
      category: "port.renewed",
      severity: "info",
      title: "t",
      message: "m",
    });

    const headers = (mockFetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tk_secret");
  });

  it("merges defaultTags after the severity tag", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", mockFetch);

    const notifier = createNtfyNotifier({
      ...baseSettings,
      defaultTags: ["vpn", "portmanager"],
    });
    await notifier.send({
      category: "port.renewed",
      severity: "info",
      title: "t",
      message: "m",
    });

    const headers = (mockFetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["Tags"]).toBe("information_source,vpn,portmanager");
  });

  it("overrides severity-derived priority when settings.priority is set", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", mockFetch);

    const notifier = createNtfyNotifier({ ...baseSettings, priority: 2 });
    await notifier.send({
      category: "port.recreate_failed",
      severity: "error",
      title: "t",
      message: "m",
    });

    const headers = (mockFetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["Priority"]).toBe("2");
  });

  it("throws on non-2xx with status + body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: () => Promise.resolve("nope"),
    } as unknown as Response);
    vi.stubGlobal("fetch", mockFetch);

    const notifier = createNtfyNotifier(baseSettings);
    await expect(
      notifier.send({ category: "port.renewed", severity: "info", title: "t", message: "m" })
    ).rejects.toThrow(/403.*Forbidden.*nope/);
  });

  it("test() sends a probe with success tag", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", mockFetch);

    const notifier = createNtfyNotifier(baseSettings);
    await notifier.test();

    const headers = (mockFetch.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["Title"]).toBe("Test notification");
    expect(headers["Tags"]).toBe("white_check_mark");
  });

  it("strips trailing slash on serverUrl and URL-encodes the topic", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", mockFetch);

    const notifier = createNtfyNotifier({
      ...baseSettings,
      serverUrl: "https://ntfy.example.com/",
      topic: "my topic",
    });
    await notifier.send({
      category: "port.renewed",
      severity: "info",
      title: "t",
      message: "m",
    });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ntfy.example.com/my%20topic");
  });
});
