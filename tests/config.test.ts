import { describe, it, expect, beforeEach } from "vitest";

describe("config", () => {
  beforeEach(() => {
    process.env.VPN_PROVIDER = "azire";
    process.env.VPN_API_TOKEN = "test-token";
    process.env.VPN_INTERNAL_IP = "10.0.16.181";
    process.env.UNIFI_HOST = "https://192.168.1.1";
    process.env.UNIFI_USERNAME = "admin";
    process.env.UNIFI_PASSWORD = "pass";
    process.env.UNIFI_VPN_INTERFACE = "wg0";
  });

  it("parses all required env vars", async () => {
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();
    expect(config.vpnProvider).toBe("azire");
    expect(config.vpnApiToken).toBe("test-token");
    expect(config.vpnInternalIp).toBe("10.0.16.181");
    expect(config.unifiHost).toBe("https://192.168.1.1");
    expect(config.unifiUsername).toBe("admin");
    expect(config.unifiPassword).toBe("pass");
    expect(config.unifiVpnInterface).toBe("wg0");
  });

  it("uses defaults for optional vars", async () => {
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();
    expect(config.maxPorts).toBe(5);
    expect(config.syncIntervalMs).toBe(300000);
    expect(config.renewThresholdDays).toBe(30);
    expect(config.port).toBe(3000);
  });

  it("throws on missing required vars", async () => {
    delete process.env.VPN_API_TOKEN;
    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow();
  });
});
