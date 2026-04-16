import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUnifiClient } from "../../src/unifi/client.js";

const HOST = "https://unifi.example.com";
const USERNAME = "admin";
const PASSWORD = "secret";

function makeFetch(responses: Response[]) {
  let idx = 0;
  return vi.fn(() => Promise.resolve(responses[idx++]));
}

function mockResponse(
  body: unknown,
  opts: { status?: number; statusText?: string; headers?: Record<string, string> } = {}
): Response {
  const { status = 200, statusText = "OK", headers = {} } = opts;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function loginResponse() {
  return mockResponse(
    { data: [] },
    { headers: { "set-cookie": "TOKEN=abc123; Path=/; HttpOnly" } }
  );
}

describe("UniFi client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("logs in and stores cookie", async () => {
    fetchMock.mockResolvedValueOnce(loginResponse());

    const client = createUnifiClient({
      host: HOST,
      username: USERNAME,
      password: PASSWORD,
      vpnInterface: "wg0",
    });

    await client.login();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${HOST}/api/auth/login`);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({
      username: USERNAME,
      password: PASSWORD,
    });

    // Subsequent request should include the cookie
    fetchMock.mockResolvedValueOnce(
      mockResponse({ data: [{ _id: "nat-1" }] })
    );
    await client.getDnatRule("nat-1");
    const [, apiOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((apiOpts.headers as Record<string, string>)["Cookie"]).toBe(
      "TOKEN=abc123"
    );
  });

  it("creates a DNAT rule and returns its ID", async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(
        mockResponse({ data: [{ _id: "nat-abc", name: "test" }] })
      );

    const client = createUnifiClient({
      host: HOST,
      username: USERNAME,
      password: PASSWORD,
      vpnInterface: "wg0",
    });
    await client.login();

    const id = await client.createDnatRule({
      name: "test",
      enabled: true,
      pfwd_interface: "wan",
      src: "any",
      dst_port: "51820",
      fwd: "10.0.0.1",
      fwd_port: "51820",
      proto: "udp",
      log: false,
    });

    expect(id).toBe("nat-abc");
    const [url, opts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${HOST}/proxy/network/api/s/default/rest/nat`);
    expect(opts.method).toBe("POST");
  });

  it("deletes a DNAT rule using the correct URL", async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(mockResponse({}));

    const client = createUnifiClient({
      host: HOST,
      username: USERNAME,
      password: PASSWORD,
      vpnInterface: "wg0",
    });
    await client.login();
    await client.deleteDnatRule("nat-xyz");

    const [url, opts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(
      `${HOST}/proxy/network/api/s/default/rest/nat/nat-xyz`
    );
    expect(opts.method).toBe("DELETE");
  });

  it("creates a firewall rule and returns its ID", async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(
        mockResponse({ data: [{ _id: "fw-123", name: "allow-vpn" }] })
      );

    const client = createUnifiClient({
      host: HOST,
      username: USERNAME,
      password: PASSWORD,
      vpnInterface: "wg0",
    });
    await client.login();

    const id = await client.createFirewallRule({
      name: "allow-vpn",
      enabled: true,
      ruleset: "WAN_IN",
      rule_index: 2000,
      action: "accept",
      protocol: "udp",
      src_firewallgroup_ids: [],
      dst_address: "10.0.0.1",
      dst_port: "51820",
      logging: false,
    });

    expect(id).toBe("fw-123");
    const [url, opts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(
      `${HOST}/proxy/network/api/s/default/rest/firewallrule`
    );
    expect(opts.method).toBe("POST");
  });

  it("returns null for a non-existent rule (404)", async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(
        mockResponse(null, { status: 404, statusText: "Not Found" })
      );

    const client = createUnifiClient({
      host: HOST,
      username: USERNAME,
      password: PASSWORD,
      vpnInterface: "wg0",
    });
    await client.login();

    const result = await client.getDnatRule("does-not-exist");
    expect(result).toBeNull();
  });
});
