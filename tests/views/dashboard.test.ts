import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dashboardView, type DashboardStatus, type MappingWithHooks } from "../../src/views/dashboard.js";

const status: DashboardStatus = {
  provider: { connected: true, name: "azire", activePorts: 1, maxPorts: 5 },
  router: { connected: true, name: "unifi" },
  externalIp: "203.0.113.1",
};

function baseMapping(overrides: Partial<MappingWithHooks> = {}): MappingWithHooks {
  return {
    id: "m1",
    provider: "azire",
    vpnPort: 51820,
    destIp: "10.0.0.10",
    destPort: 22,
    protocol: "tcp",
    label: "ssh",
    status: "active",
    expiresAt: 0,
    routerHandle: {},
    createdAt: 0,
    updatedAt: 0,
    hooks: [],
    ...overrides,
  };
}

describe("dashboardView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders mapping expiry from seconds (not ms) — 10d left when expiresAt is now+10d seconds", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const m = baseMapping({ expiresAt: nowSec + 10 * 86400 });
    const html = dashboardView([m], status);
    expect(html).toContain("10d left");
    expect(html).not.toContain("Expired");
  });

  it("renders Expired when expiresAt (seconds) is in the past", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const m = baseMapping({ expiresAt: nowSec - 3600 });
    const html = dashboardView([m], status);
    expect(html).toContain("Expired");
  });

  it("renders VPN port as a click-to-copy button when externalIp is known", () => {
    const m = baseMapping({ vpnPort: 60000 });
    const html = dashboardView([m], status);
    expect(html).toContain('data-copy="203.0.113.1:60000"');
    expect(html).toContain("button");
  });

  it("renders plain port span when externalIp is null", () => {
    const m = baseMapping({ vpnPort: 60000 });
    const html = dashboardView([m], { ...status, externalIp: null });
    expect(html).not.toContain("data-copy");
    expect(html).toContain('<span class="port-num">60000</span>');
  });

  it("renders a Dangling Ports section only when there are dangling ports", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const noDangling = dashboardView([], status);
    expect(noDangling).not.toContain("Dangling Ports");

    const withDangling = dashboardView([], status, [{ port: 7777, expiresAt: nowSec + 5 * 86400 }]);
    expect(withDangling).toContain("Dangling Ports");
    expect(withDangling).toContain("/create?adopt=7777");
    expect(withDangling).toContain("/dangling/7777/release");
    expect(withDangling).toContain("5d left");
  });
});
