import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouter } from "../../src/routers/index.js";
import type { PortForwardSpec, RouterSettings } from "../../src/routers/types.js";

const settings: RouterSettings = {
  type: "unifi",
  host: "https://unifi.example.com",
  username: "admin",
  password: "secret",
  vpnInterface: "wg0",
};

const spec: PortForwardSpec = {
  vpnPort: 51820,
  destIp: "192.168.1.100",
  destPort: 32400,
  protocol: "tcp_udp",
  label: "plex",
};

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

function loginResponse(): Response {
  return mockResponse(
    { data: [] },
    { headers: { "set-cookie": "TOKEN=abc123; Path=/; HttpOnly" } }
  );
}

describe("UniFi RouterClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("ensurePortForward logs in, creates DNAT + firewall rules, returns handle", async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(mockResponse({ data: [{ _id: "nat-1" }] }))
      .mockResolvedValueOnce(mockResponse({ data: [{ _id: "fw-1" }] }));

    const router = createRouter(settings);
    const handle = await router.ensurePortForward(spec);

    expect(handle).toEqual({ dnatId: "nat-1", firewallId: "fw-1" });

    const [natUrl, natOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(natUrl).toBe(`${settings.host}/proxy/network/api/s/default/rest/nat`);
    expect(natOpts.method).toBe("POST");
    const natBody = JSON.parse(natOpts.body as string);
    expect(natBody.pfwd_interface).toBe("wg0");
    expect(natBody.dst_port).toBe("51820");
    expect(natBody.fwd).toBe("192.168.1.100");
    expect(natBody.fwd_port).toBe("32400");
    expect(natBody.proto).toBe("tcp_udp");
    expect(natBody.name).toContain("plex");

    const [fwUrl, fwOpts] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(fwUrl).toBe(`${settings.host}/proxy/network/api/s/default/rest/firewallrule`);
    const fwBody = JSON.parse(fwOpts.body as string);
    expect(fwBody.ruleset).toBe("WAN_IN");
    expect(fwBody.dst_address).toBe("192.168.1.100");
    expect(fwBody.dst_port).toBe("32400");
    expect(fwBody.protocol).toBe("tcp_udp");
  });

  it("updatePortForward PUTs both rules with new fields", async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(mockResponse({}))
      .mockResolvedValueOnce(mockResponse({}));

    const router = createRouter(settings);
    const newHandle = await router.updatePortForward(
      { dnatId: "nat-1", firewallId: "fw-1" },
      { ...spec, destIp: "192.168.1.200", destPort: 8443 }
    );

    expect(newHandle).toEqual({ dnatId: "nat-1", firewallId: "fw-1" });

    const [natUrl, natOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(natUrl).toBe(`${settings.host}/proxy/network/api/s/default/rest/nat/nat-1`);
    expect(natOpts.method).toBe("PUT");
    const natBody = JSON.parse(natOpts.body as string);
    expect(natBody.fwd).toBe("192.168.1.200");
    expect(natBody.fwd_port).toBe("8443");

    const [fwUrl] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(fwUrl).toBe(`${settings.host}/proxy/network/api/s/default/rest/firewallrule/fw-1`);
  });

  it("deletePortForward DELETEs both rules, swallowing errors", async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(mockResponse(null, { status: 404, statusText: "Not Found" }))
      .mockResolvedValueOnce(mockResponse({}));

    const router = createRouter(settings);
    await expect(
      router.deletePortForward({ dnatId: "nat-1", firewallId: "fw-1" })
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const methods = fetchMock.mock.calls.slice(1).map((c) => (c[1] as RequestInit).method);
    expect(methods).toEqual(["DELETE", "DELETE"]);
  });

  it("repairPortForward re-creates missing DNAT rule, keeps existing firewall rule", async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse(null, { status: 404, statusText: "Not Found" }))
      .mockResolvedValueOnce(mockResponse({ data: [{ _id: "nat-new" }] }))
      .mockResolvedValueOnce(mockResponse({ data: [{ _id: "fw-old" }] }));

    const router = createRouter(settings);
    const newHandle = await router.repairPortForward(
      { dnatId: "nat-gone", firewallId: "fw-old" },
      spec
    );

    expect(newHandle).toEqual({ dnatId: "nat-new", firewallId: "fw-old" });
  });

  it("testConnection returns ok on success", async () => {
    fetchMock.mockResolvedValueOnce(loginResponse());
    const router = createRouter(settings);
    await expect(router.testConnection()).resolves.toEqual({ ok: true });
  });

  it("testConnection returns ok:false with message on auth failure", async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ error: "bad creds" }, { status: 401, statusText: "Unauthorized" })
    );
    const router = createRouter(settings);
    const result = await router.testConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });
});
