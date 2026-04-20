import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouter } from "../../src/routers/index.js";
import type { PortForwardSpec, RouterSettings } from "../../src/routers/types.js";

const settings: RouterSettings = {
  type: "unifi",
  host: "https://unifi.example.com",
  username: "admin",
  password: "secret",
  inInterfaceId: "iface-id-123",
  sourceZoneId: "zone-src-456",
  destinationZoneId: "zone-dst-789",
};

const spec: PortForwardSpec = {
  vpnPort: 51820,
  destIp: "192.168.1.100",
  destPort: 32400,
  protocol: "tcp_udp",
  label: "plex",
};

const V2 = "/proxy/network/v2/api/site/default";

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
    clone(): Response {
      return this as unknown as Response;
    },
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function loginResponse(extraHeaders: Record<string, string> = {}): Response {
  return mockResponse(
    { data: [] },
    {
      headers: {
        "set-cookie": "TOKEN=abc123; Path=/; HttpOnly",
        "x-csrf-token": "csrf-xyz",
        ...extraHeaders,
      },
    }
  );
}

describe("UniFi RouterClient (v2)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("ensurePortForward posts a DNAT rule and a firewall policy", async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(mockResponse({ _id: "nat-1" }))
      .mockResolvedValueOnce(mockResponse({ _id: "fw-1" }));

    const router = createRouter(settings);
    const handle = await router.ensurePortForward(spec);

    expect(handle).toEqual({ natId: "nat-1", firewallId: "fw-1" });

    const [natUrl, natOpts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(natUrl).toBe(`${settings.host}${V2}/nat`);
    expect(natOpts.method).toBe("POST");
    const natBody = JSON.parse(natOpts.body as string);
    expect(natBody).toMatchObject({
      type: "DNAT",
      ip_version: "IPV4",
      in_interface: "iface-id-123",
      protocol: "tcp_udp",
      port: "32400",
      ip_address: "192.168.1.100",
      destination_filter: { filter_type: "ADDRESS_AND_PORT", port: "51820", invert_port: false },
      source_filter: { filter_type: "NONE" },
      setting_preference: "manual",
    });
    expect((natOpts.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-xyz");

    const [fwUrl, fwOpts] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(fwUrl).toBe(`${settings.host}${V2}/firewall-policies`);
    const fwBody = JSON.parse(fwOpts.body as string);
    expect(fwBody).toMatchObject({
      action: "ALLOW",
      create_allow_respond: true,
      protocol: "tcp_udp",
      source: { zone_id: "zone-src-456", matching_target: "ANY" },
      destination: {
        zone_id: "zone-dst-789",
        port: "32400",
        ips: ["192.168.1.100"],
      },
    });
  });

  it("rolls back the NAT rule when firewall creation fails", async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(mockResponse({ _id: "nat-1" }))
      .mockResolvedValueOnce(mockResponse({ meta: { msg: "bad zone" } }, { status: 400, statusText: "Bad Request" }))
      .mockResolvedValueOnce(mockResponse({}));

    const router = createRouter(settings);
    await expect(router.ensurePortForward(spec)).rejects.toThrow(/bad zone/);

    const rollback = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(rollback[0]).toBe(`${settings.host}${V2}/nat/nat-1`);
    expect(rollback[1].method).toBe("DELETE");
  });

  it("updatePortForward PUTs both resources with new fields", async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(mockResponse({}))
      .mockResolvedValueOnce(mockResponse({}));

    const router = createRouter(settings);
    const handle = await router.updatePortForward(
      { natId: "nat-1", firewallId: "fw-1" },
      { ...spec, destIp: "192.168.1.200", destPort: 8443 }
    );

    expect(handle).toEqual({ natId: "nat-1", firewallId: "fw-1" });
    expect(fetchMock.mock.calls[1][0]).toBe(`${settings.host}${V2}/nat/nat-1`);
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("PUT");
    expect(fetchMock.mock.calls[2][0]).toBe(`${settings.host}${V2}/firewall-policies/fw-1`);
    expect((fetchMock.mock.calls[2][1] as RequestInit).method).toBe("PUT");
  });

  it("deletePortForward DELETEs NAT then batch-deletes firewall", async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(mockResponse({}))
      .mockResolvedValueOnce(mockResponse({}));

    const router = createRouter(settings);
    await router.deletePortForward({ natId: "nat-1", firewallId: "fw-1" });

    expect(fetchMock.mock.calls[1][0]).toBe(`${settings.host}${V2}/nat/nat-1`);
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("DELETE");

    expect(fetchMock.mock.calls[2][0]).toBe(`${settings.host}${V2}/firewall-policies/batch-delete`);
    const delOpts = fetchMock.mock.calls[2][1] as RequestInit;
    expect(delOpts.method).toBe("POST");
    expect(JSON.parse(delOpts.body as string)).toEqual(["fw-1"]);
  });

  it("repairPortForward re-creates only missing resources", async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(mockResponse(null, { status: 404, statusText: "Not Found" }))
      .mockResolvedValueOnce(mockResponse({ _id: "nat-new" }))
      .mockResolvedValueOnce(mockResponse({ _id: "fw-old" }));

    const router = createRouter(settings);
    const handle = await router.repairPortForward(
      { natId: "nat-gone", firewallId: "fw-old" },
      spec
    );

    expect(handle).toEqual({ natId: "nat-new", firewallId: "fw-old" });
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

  it("surfaces UniFi meta.msg when a request fails", async () => {
    fetchMock
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(
        mockResponse(
          { meta: { msg: "api.err.InvalidObject" } },
          { status: 400, statusText: "Bad Request" }
        )
      )
      .mockResolvedValueOnce(mockResponse({})); // rollback delete

    const router = createRouter(settings);
    await expect(router.ensurePortForward(spec)).rejects.toThrow(/api\.err\.InvalidObject/);
  });
});
