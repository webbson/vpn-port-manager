import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAzireProvider } from "../../src/providers/azire.js";

const TEST_TOKEN = "test-api-token";
const TEST_IP = "10.0.16.181";

function makeProvider() {
  return createAzireProvider({ apiToken: TEST_TOKEN, internalIp: TEST_IP });
}

function mockOkResponse(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

function mockErrorResponse(status: number, message: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: message,
    json: () => Promise.resolve({ message }),
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAzireProvider", () => {
  it("has correct name and maxPorts", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("azire");
    expect(provider.maxPorts).toBe(5);
  });

  it("lists ports with correct URL and auth header", async () => {
    const mockFetch = mockOkResponse({
      data: {
        ports: [
          { port: 51820, hidden: false, expires_at: 1700000000 },
          { port: 51821, hidden: false, expires_at: 1700000001 },
        ],
      },
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = makeProvider();
    const ports = await provider.listPorts();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`internal_ipv4=${encodeURIComponent(TEST_IP)}`);
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${TEST_TOKEN}`
    );

    expect(ports).toEqual([
      { port: 51820, expiresAt: 1700000000 },
      { port: 51821, expiresAt: 1700000001 },
    ]);
  });

  it("creates a port with correct POST body", async () => {
    const mockFetch = mockOkResponse({
      data: { port: 51820, expires_at: 1700000000 },
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = makeProvider();
    const result = await provider.createPort({ expiresInDays: 30 });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.internal_ipv4).toBe(TEST_IP);
    expect(body.hidden).toBe(false);
    expect(body.expires_in).toBe(30);

    expect(result).toEqual({ port: 51820, expiresAt: 1700000000 });
  });

  it("creates a port with default expires_in of 365 when not specified", async () => {
    const mockFetch = mockOkResponse({
      data: { port: 51820, expires_at: 1700000000 },
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = makeProvider();
    await provider.createPort();

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.expires_in).toBe(365);
  });

  it("deletes a port with correct DELETE body", async () => {
    const mockFetch = mockOkResponse({});
    vi.stubGlobal("fetch", mockFetch);

    const provider = makeProvider();
    await provider.deletePort(51820);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe("DELETE");
    const body = JSON.parse(opts.body as string);
    expect(body.internal_ipv4).toBe(TEST_IP);
    expect(body.port).toBe(51820);
  });

  it("checks a port and returns true on success", async () => {
    const mockFetch = mockOkResponse({ status: "ok" });
    vi.stubGlobal("fetch", mockFetch);

    const provider = makeProvider();
    const result = await provider.checkPort(51820);

    expect(result).toBe(true);
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/check/51820");
  });

  it("checks a port and returns false on error", async () => {
    const mockFetch = mockErrorResponse(404, "Not found");
    vi.stubGlobal("fetch", mockFetch);

    const provider = makeProvider();
    const result = await provider.checkPort(99999);

    expect(result).toBe(false);
  });

  it("throws on API error with status and message", async () => {
    const mockFetch = mockErrorResponse(401, "Unauthorized");
    vi.stubGlobal("fetch", mockFetch);

    const provider = makeProvider();
    await expect(provider.listPorts()).rejects.toThrow(
      "Azire API error (401): Unauthorized"
    );
  });
});
