import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ENV_KEYS = ["PORT", "APP_SECRET_KEY", "DB_PATH"];

function captureEnv() {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("config", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = captureEnv();
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.APP_SECRET_KEY = "sixteen-or-more-chars-key";
  });

  afterEach(() => restoreEnv(saved));

  it("parses APP_SECRET_KEY and defaults for port and db path", async () => {
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();
    expect(config.appSecretKey).toBe("sixteen-or-more-chars-key");
    expect(config.port).toBe(3000);
    expect(config.dbPath).toBe("/data/vpnportmanager.db");
  });

  it("honours PORT and DB_PATH overrides", async () => {
    process.env.PORT = "4567";
    process.env.DB_PATH = "/tmp/custom.db";
    const { loadConfig } = await import("../src/config.js");
    const config = loadConfig();
    expect(config.port).toBe(4567);
    expect(config.dbPath).toBe("/tmp/custom.db");
  });

  it("throws when APP_SECRET_KEY is missing", async () => {
    delete process.env.APP_SECRET_KEY;
    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow();
  });

  it("rejects short APP_SECRET_KEY values", async () => {
    process.env.APP_SECRET_KEY = "too-short";
    const { loadConfig } = await import("../src/config.js");
    expect(() => loadConfig()).toThrow();
  });
});
