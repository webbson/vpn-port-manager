# VPN Port Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Docker-based web UI that manages VPN port forwardings (Azire VPN), creates UniFi DNAT/firewall rules, and fires post-step hooks when ports change.

**Architecture:** Four-layer system: Provider (VPN API abstraction), State (SQLite), UniFi (DNAT/firewall rule management), Hook (plugins/webhooks/commands). Hybrid action model -- user actions execute immediately, sync watchdog runs periodically as safety net.

**Tech Stack:** TypeScript, Hono, better-sqlite3, server-rendered HTML, Docker, pnpm, Vitest

**Spec:** `docs/superpowers/specs/2026-04-15-vpn-port-manager-design.md`

---

## File Structure

```
src/
  index.ts                  # Entry point: starts Hono server + sync watchdog
  config.ts                 # Env var parsing + validation with zod
  db.ts                     # SQLite setup, migrations, query helpers
  providers/
    types.ts                # VpnProvider interface + ProviderPort type
    azire.ts                # Azire VPN provider implementation
    index.ts                # Provider registry (map of name -> provider)
  unifi/
    client.ts               # UniFi API client (auth, DNAT, firewall)
    types.ts                # UniFi API types
  hooks/
    types.ts                # HookPayload, HookConfig types
    runner.ts               # Hook executor (dispatches to plugin/webhook/command)
    plugins/
      plex.ts               # Plex built-in plugin
  sync.ts                   # Sync watchdog logic
  routes/
    api.ts                  # REST API routes (Hono)
    ui.ts                   # Server-rendered HTML routes (Hono)
  views/
    layout.ts               # HTML layout wrapper
    dashboard.ts            # Dashboard view
    create.ts               # Create mapping form view
    edit.ts                 # Edit mapping view
    logs.ts                 # Sync log view
tests/
  config.test.ts
  db.test.ts
  providers/azire.test.ts
  unifi/client.test.ts
  hooks/runner.test.ts
  hooks/plugins/plex.test.ts
  sync.test.ts
  routes/api.test.ts
Dockerfile
docker-compose.yml
.env.example
tsconfig.json
package.json
```

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `src/index.ts`
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Initialize project with pnpm**

```bash
pnpm init
```

- [ ] **Step 2: Install dependencies**

```bash
pnpm add hono @hono/node-server better-sqlite3 zod uuid
pnpm add -D typescript @types/node @types/better-sqlite3 @types/uuid vitest
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create .env.example**

```env
VPN_PROVIDER=azire
VPN_API_TOKEN=your-azire-api-token
VPN_INTERNAL_IP=10.0.16.181
MAX_PORTS=5
UNIFI_HOST=https://192.168.1.1
UNIFI_USERNAME=portmanager
UNIFI_PASSWORD=your-password
UNIFI_VPN_INTERFACE=wg0
SYNC_INTERVAL_MS=300000
RENEW_THRESHOLD_DAYS=30
PORT=3000
```

- [ ] **Step 5: Write config test**

```typescript
// tests/config.test.ts
import { describe, it, expect, beforeEach } from "vitest";

describe("config", () => {
  beforeEach(() => {
    // Set required env vars
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
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm vitest run tests/config.test.ts
```

Expected: FAIL -- `src/config.ts` doesn't exist yet.

- [ ] **Step 7: Implement config.ts**

```typescript
// src/config.ts
import { z } from "zod";

const configSchema = z.object({
  vpnProvider: z.string().min(1),
  vpnApiToken: z.string().min(1),
  vpnInternalIp: z.string().min(1),
  maxPorts: z.number().int().positive().default(5),
  unifiHost: z.string().url(),
  unifiUsername: z.string().min(1),
  unifiPassword: z.string().min(1),
  unifiVpnInterface: z.string().min(1),
  syncIntervalMs: z.number().int().positive().default(300000),
  renewThresholdDays: z.number().int().positive().default(30),
  port: z.number().int().positive().default(3000),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    vpnProvider: process.env.VPN_PROVIDER,
    vpnApiToken: process.env.VPN_API_TOKEN,
    vpnInternalIp: process.env.VPN_INTERNAL_IP,
    maxPorts: process.env.MAX_PORTS ? Number(process.env.MAX_PORTS) : undefined,
    unifiHost: process.env.UNIFI_HOST,
    unifiUsername: process.env.UNIFI_USERNAME,
    unifiPassword: process.env.UNIFI_PASSWORD,
    unifiVpnInterface: process.env.UNIFI_VPN_INTERFACE,
    syncIntervalMs: process.env.SYNC_INTERVAL_MS
      ? Number(process.env.SYNC_INTERVAL_MS)
      : undefined,
    renewThresholdDays: process.env.RENEW_THRESHOLD_DAYS
      ? Number(process.env.RENEW_THRESHOLD_DAYS)
      : undefined,
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  });
}
```

- [ ] **Step 8: Create stub entry point**

```typescript
// src/index.ts
import { loadConfig } from "./config.js";

const config = loadConfig();
console.log(`VPN Port Manager starting with provider: ${config.vpnProvider}`);
```

- [ ] **Step 9: Add scripts to package.json**

Add to `package.json`:
```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Install tsx for dev mode:
```bash
pnpm add -D tsx
```

- [ ] **Step 10: Run tests and verify they pass**

```bash
pnpm test
```

Expected: All 3 tests in `config.test.ts` PASS.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: project scaffold with config parsing and validation"
```

---

### Task 2: Database Layer

**Files:**
- Create: `src/db.ts`
- Create: `tests/db.test.ts`

- [ ] **Step 1: Write database tests**

```typescript
// tests/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createDb, type Db } from "../src/db.js";

describe("db", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("port_mappings", () => {
    it("inserts and retrieves a mapping", () => {
      const id = db.createMapping({
        provider: "azire",
        vpnPort: 58216,
        destIp: "10.0.17.249",
        destPort: 32400,
        protocol: "tcp",
        label: "Plex",
        status: "active",
        expiresAt: 1687434503,
      });
      const mapping = db.getMapping(id);
      expect(mapping).not.toBeNull();
      expect(mapping!.vpnPort).toBe(58216);
      expect(mapping!.label).toBe("Plex");
      expect(mapping!.status).toBe("active");
    });

    it("lists all mappings", () => {
      db.createMapping({
        provider: "azire",
        vpnPort: 58216,
        destIp: "10.0.17.249",
        destPort: 32400,
        protocol: "tcp",
        label: "Plex",
        status: "active",
        expiresAt: 1687434503,
      });
      db.createMapping({
        provider: "azire",
        vpnPort: 58217,
        destIp: "10.0.17.250",
        destPort: 80,
        protocol: "both",
        label: "Web",
        status: "active",
        expiresAt: 1687434503,
      });
      const mappings = db.listMappings();
      expect(mappings).toHaveLength(2);
    });

    it("updates a mapping", () => {
      const id = db.createMapping({
        provider: "azire",
        vpnPort: 58216,
        destIp: "10.0.17.249",
        destPort: 32400,
        protocol: "tcp",
        label: "Plex",
        status: "active",
        expiresAt: 1687434503,
      });
      db.updateMapping(id, { vpnPort: 59000, status: "active" });
      const mapping = db.getMapping(id);
      expect(mapping!.vpnPort).toBe(59000);
    });

    it("deletes a mapping", () => {
      const id = db.createMapping({
        provider: "azire",
        vpnPort: 58216,
        destIp: "10.0.17.249",
        destPort: 32400,
        protocol: "tcp",
        label: "Plex",
        status: "active",
        expiresAt: 1687434503,
      });
      db.deleteMapping(id);
      expect(db.getMapping(id)).toBeNull();
    });
  });

  describe("hooks", () => {
    it("creates and lists hooks for a mapping", () => {
      const mappingId = db.createMapping({
        provider: "azire",
        vpnPort: 58216,
        destIp: "10.0.17.249",
        destPort: 32400,
        protocol: "tcp",
        label: "Plex",
        status: "active",
        expiresAt: 1687434503,
      });
      db.createHook({
        mappingId,
        type: "plugin",
        config: JSON.stringify({ plugin: "plex", host: "http://10.0.17.249:32400", token: "abc" }),
      });
      db.createHook({
        mappingId,
        type: "webhook",
        config: JSON.stringify({ url: "http://example.com/hook" }),
      });
      const hooks = db.listHooks(mappingId);
      expect(hooks).toHaveLength(2);
      expect(hooks[0].type).toBe("plugin");
    });

    it("deletes hooks when mapping is deleted", () => {
      const mappingId = db.createMapping({
        provider: "azire",
        vpnPort: 58216,
        destIp: "10.0.17.249",
        destPort: 32400,
        protocol: "tcp",
        label: "Plex",
        status: "active",
        expiresAt: 1687434503,
      });
      db.createHook({
        mappingId,
        type: "plugin",
        config: JSON.stringify({ plugin: "plex" }),
      });
      db.deleteMapping(mappingId);
      const hooks = db.listHooks(mappingId);
      expect(hooks).toHaveLength(0);
    });
  });

  describe("sync_log", () => {
    it("logs and retrieves entries", () => {
      db.logSync("create", "mapping-1", { port: 58216 });
      db.logSync("hook_fired", "mapping-1", { hook: "plex", status: "success" });
      const logs = db.getRecentLogs(10);
      expect(logs).toHaveLength(2);
      expect(logs[0].action).toBe("hook_fired"); // newest first
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run tests/db.test.ts
```

Expected: FAIL -- `src/db.ts` doesn't exist yet.

- [ ] **Step 3: Implement db.ts**

```typescript
// src/db.ts
import Database from "better-sqlite3";
import { v4 as uuid } from "uuid";

export interface PortMapping {
  id: string;
  provider: string;
  vpnPort: number;
  destIp: string;
  destPort: number;
  protocol: string;
  label: string;
  status: string;
  expiresAt: number;
  unifiDnatId: string | null;
  unifiFirewallId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Hook {
  id: string;
  mappingId: string;
  type: string;
  config: string;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
}

export interface SyncLogEntry {
  id: number;
  timestamp: number;
  action: string;
  mappingId: string | null;
  details: string;
}

export interface CreateMappingInput {
  provider: string;
  vpnPort: number;
  destIp: string;
  destPort: number;
  protocol: string;
  label: string;
  status: string;
  expiresAt: number;
}

export interface UpdateMappingInput {
  vpnPort?: number;
  destIp?: string;
  destPort?: number;
  protocol?: string;
  label?: string;
  status?: string;
  expiresAt?: number;
  unifiDnatId?: string | null;
  unifiFirewallId?: string | null;
}

export interface CreateHookInput {
  mappingId: string;
  type: string;
  config: string;
}

export interface Db {
  close(): void;
  createMapping(input: CreateMappingInput): string;
  getMapping(id: string): PortMapping | null;
  listMappings(): PortMapping[];
  updateMapping(id: string, input: UpdateMappingInput): void;
  deleteMapping(id: string): void;
  createHook(input: CreateHookInput): string;
  listHooks(mappingId: string): Hook[];
  deleteHook(id: string): void;
  updateHookStatus(id: string, status: string, error?: string): void;
  logSync(action: string, mappingId: string | null, details: object): void;
  getRecentLogs(limit: number): SyncLogEntry[];
}

export function createDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS port_mappings (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      vpn_port INTEGER NOT NULL,
      dest_ip TEXT NOT NULL,
      dest_port INTEGER NOT NULL,
      protocol TEXT NOT NULL DEFAULT 'both',
      label TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at INTEGER NOT NULL,
      unifi_dnat_id TEXT,
      unifi_firewall_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hooks (
      id TEXT PRIMARY KEY,
      mapping_id TEXT NOT NULL REFERENCES port_mappings(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      last_run_at INTEGER,
      last_status TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      action TEXT NOT NULL,
      mapping_id TEXT,
      details TEXT NOT NULL DEFAULT '{}'
    );
  `);

  const stmts = {
    insertMapping: db.prepare(`
      INSERT INTO port_mappings (id, provider, vpn_port, dest_ip, dest_port, protocol, label, status, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getMapping: db.prepare(`SELECT * FROM port_mappings WHERE id = ?`),
    listMappings: db.prepare(`SELECT * FROM port_mappings ORDER BY created_at DESC`),
    deleteMapping: db.prepare(`DELETE FROM port_mappings WHERE id = ?`),
    insertHook: db.prepare(`
      INSERT INTO hooks (id, mapping_id, type, config) VALUES (?, ?, ?, ?)
    `),
    listHooks: db.prepare(`SELECT * FROM hooks WHERE mapping_id = ?`),
    deleteHook: db.prepare(`DELETE FROM hooks WHERE id = ?`),
    updateHookStatus: db.prepare(`
      UPDATE hooks SET last_run_at = ?, last_status = ?, last_error = ? WHERE id = ?
    `),
    insertLog: db.prepare(`
      INSERT INTO sync_log (timestamp, action, mapping_id, details) VALUES (?, ?, ?, ?)
    `),
    recentLogs: db.prepare(`SELECT * FROM sync_log ORDER BY timestamp DESC, id DESC LIMIT ?`),
  };

  function rowToMapping(row: any): PortMapping {
    return {
      id: row.id,
      provider: row.provider,
      vpnPort: row.vpn_port,
      destIp: row.dest_ip,
      destPort: row.dest_port,
      protocol: row.protocol,
      label: row.label,
      status: row.status,
      expiresAt: row.expires_at,
      unifiDnatId: row.unifi_dnat_id,
      unifiFirewallId: row.unifi_firewall_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function rowToHook(row: any): Hook {
    return {
      id: row.id,
      mappingId: row.mapping_id,
      type: row.type,
      config: row.config,
      lastRunAt: row.last_run_at,
      lastStatus: row.last_status,
      lastError: row.last_error,
    };
  }

  function rowToLog(row: any): SyncLogEntry {
    return {
      id: row.id,
      timestamp: row.timestamp,
      action: row.action,
      mappingId: row.mapping_id,
      details: row.details,
    };
  }

  return {
    close() {
      db.close();
    },

    createMapping(input) {
      const id = uuid();
      const now = Math.floor(Date.now() / 1000);
      stmts.insertMapping.run(
        id, input.provider, input.vpnPort, input.destIp, input.destPort,
        input.protocol, input.label, input.status, input.expiresAt, now, now
      );
      return id;
    },

    getMapping(id) {
      const row = stmts.getMapping.get(id);
      return row ? rowToMapping(row) : null;
    },

    listMappings() {
      return stmts.listMappings.all().map(rowToMapping);
    },

    updateMapping(id, input) {
      const sets: string[] = [];
      const values: any[] = [];
      if (input.vpnPort !== undefined) { sets.push("vpn_port = ?"); values.push(input.vpnPort); }
      if (input.destIp !== undefined) { sets.push("dest_ip = ?"); values.push(input.destIp); }
      if (input.destPort !== undefined) { sets.push("dest_port = ?"); values.push(input.destPort); }
      if (input.protocol !== undefined) { sets.push("protocol = ?"); values.push(input.protocol); }
      if (input.label !== undefined) { sets.push("label = ?"); values.push(input.label); }
      if (input.status !== undefined) { sets.push("status = ?"); values.push(input.status); }
      if (input.expiresAt !== undefined) { sets.push("expires_at = ?"); values.push(input.expiresAt); }
      if (input.unifiDnatId !== undefined) { sets.push("unifi_dnat_id = ?"); values.push(input.unifiDnatId); }
      if (input.unifiFirewallId !== undefined) { sets.push("unifi_firewall_id = ?"); values.push(input.unifiFirewallId); }
      if (sets.length === 0) return;
      sets.push("updated_at = ?");
      values.push(Math.floor(Date.now() / 1000));
      values.push(id);
      db.prepare(`UPDATE port_mappings SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    },

    deleteMapping(id) {
      stmts.deleteMapping.run(id);
    },

    createHook(input) {
      const id = uuid();
      stmts.insertHook.run(id, input.mappingId, input.type, input.config);
      return id;
    },

    listHooks(mappingId) {
      return stmts.listHooks.all(mappingId).map(rowToHook);
    },

    deleteHook(id) {
      stmts.deleteHook.run(id);
    },

    updateHookStatus(id, status, error) {
      stmts.updateHookStatus.run(Math.floor(Date.now() / 1000), status, error ?? null, id);
    },

    logSync(action, mappingId, details) {
      stmts.insertLog.run(Math.floor(Date.now() / 1000), action, mappingId, JSON.stringify(details));
    },

    getRecentLogs(limit) {
      return stmts.recentLogs.all(limit).map(rowToLog);
    },
  };
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
pnpm vitest run tests/db.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db.ts tests/db.test.ts
git commit -m "feat: SQLite database layer with mappings, hooks, and sync log"
```

---

### Task 3: VPN Provider Interface + Azire Implementation

**Files:**
- Create: `src/providers/types.ts`
- Create: `src/providers/azire.ts`
- Create: `src/providers/index.ts`
- Create: `tests/providers/azire.test.ts`

- [ ] **Step 1: Create provider types**

```typescript
// src/providers/types.ts
export interface ProviderPort {
  port: number;
  expiresAt: number;
}

export interface VpnProvider {
  name: string;
  maxPorts: number;
  listPorts(): Promise<ProviderPort[]>;
  createPort(opts?: { expiresInDays?: number }): Promise<ProviderPort>;
  deletePort(port: number): Promise<void>;
  checkPort(port: number): Promise<boolean>;
}
```

- [ ] **Step 2: Write Azire provider tests**

```typescript
// tests/providers/azire.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAzireProvider } from "../src/providers/azire.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("AzireProvider", () => {
  const provider = createAzireProvider({
    apiToken: "test-token",
    internalIp: "10.0.16.181",
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("has correct name and maxPorts", () => {
    expect(provider.name).toBe("azire");
    expect(provider.maxPorts).toBe(5);
  });

  it("lists ports", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "success",
        data: {
          internal_ipv4: "10.0.16.181",
          internal_ipv6: "2a0e:1c80:1337:1:10:0:16:181",
          ports: [
            { port: 58216, hidden: false, expires_at: 1687434503 },
            { port: 58217, hidden: false, expires_at: 1687434600 },
          ],
        },
      }),
    });

    const ports = await provider.listPorts();
    expect(ports).toHaveLength(2);
    expect(ports[0]).toEqual({ port: 58216, expiresAt: 1687434503 });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.azirevpn.com/v3/portforwardings?internal_ipv4=10.0.16.181",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
  });

  it("creates a port", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "success",
        data: { port: 59000, hidden: false, expires_at: 1719000000 },
      }),
    });

    const port = await provider.createPort({ expiresInDays: 365 });
    expect(port).toEqual({ port: 59000, expiresAt: 1719000000 });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.azirevpn.com/v3/portforwardings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          internal_ipv4: "10.0.16.181",
          hidden: false,
          expires_in: 365,
        }),
      })
    );
  });

  it("deletes a port", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success" }),
    });

    await provider.deletePort(58216);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.azirevpn.com/v3/portforwardings",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({
          internal_ipv4: "10.0.16.181",
          port: 58216,
        }),
      })
    );
  });

  it("checks a port", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "success" }),
    });

    const result = await provider.checkPort(58216);
    expect(result).toBe(true);
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ status: "error", message: "Unauthorized" }),
    });

    await expect(provider.listPorts()).rejects.toThrow("Azire API error");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm vitest run tests/providers/azire.test.ts
```

Expected: FAIL -- `src/providers/azire.ts` doesn't exist yet.

- [ ] **Step 4: Implement Azire provider**

```typescript
// src/providers/azire.ts
import type { VpnProvider, ProviderPort } from "./types.js";

const BASE_URL = "https://api.azirevpn.com/v3/portforwardings";

interface AzireConfig {
  apiToken: string;
  internalIp: string;
}

export function createAzireProvider(config: AzireConfig): VpnProvider {
  const headers = {
    Authorization: `Bearer ${config.apiToken}`,
    "Content-Type": "application/json",
  };

  async function apiRequest(url: string, opts: RequestInit = {}): Promise<any> {
    const res = await fetch(url, { ...opts, headers: { ...headers, ...opts.headers } });
    const body = await res.json();
    if (!res.ok || body.status === "error") {
      throw new Error(`Azire API error (${res.status}): ${body.message ?? res.statusText}`);
    }
    return body;
  }

  return {
    name: "azire",
    maxPorts: 5,

    async listPorts(): Promise<ProviderPort[]> {
      const body = await apiRequest(
        `${BASE_URL}?internal_ipv4=${encodeURIComponent(config.internalIp)}`,
        { method: "GET" }
      );
      return (body.data.ports ?? []).map((p: any) => ({
        port: p.port,
        expiresAt: p.expires_at,
      }));
    },

    async createPort(opts?: { expiresInDays?: number }): Promise<ProviderPort> {
      const body = await apiRequest(BASE_URL, {
        method: "POST",
        body: JSON.stringify({
          internal_ipv4: config.internalIp,
          hidden: false,
          expires_in: opts?.expiresInDays ?? 365,
        }),
      });
      return { port: body.data.port, expiresAt: body.data.expires_at };
    },

    async deletePort(port: number): Promise<void> {
      await apiRequest(BASE_URL, {
        method: "DELETE",
        body: JSON.stringify({
          internal_ipv4: config.internalIp,
          port,
        }),
      });
    },

    async checkPort(port: number): Promise<boolean> {
      try {
        await apiRequest(`${BASE_URL}/check/${port}`, { method: "GET" });
        return true;
      } catch {
        return false;
      }
    },
  };
}
```

- [ ] **Step 5: Create provider registry**

```typescript
// src/providers/index.ts
import type { VpnProvider } from "./types.js";
import { createAzireProvider } from "./azire.js";
import type { Config } from "../config.js";

export type { VpnProvider, ProviderPort } from "./types.js";

export function createProvider(config: Config): VpnProvider {
  switch (config.vpnProvider) {
    case "azire":
      return createAzireProvider({
        apiToken: config.vpnApiToken,
        internalIp: config.vpnInternalIp,
      });
    default:
      throw new Error(`Unknown VPN provider: ${config.vpnProvider}`);
  }
}
```

- [ ] **Step 6: Run tests and verify they pass**

```bash
pnpm vitest run tests/providers/azire.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/providers/ tests/providers/
git commit -m "feat: VPN provider interface with Azire implementation"
```

---

### Task 4: UniFi API Client

**Files:**
- Create: `src/unifi/types.ts`
- Create: `src/unifi/client.ts`
- Create: `tests/unifi/client.test.ts`

- [ ] **Step 1: Create UniFi types**

```typescript
// src/unifi/types.ts
export interface DnatRule {
  _id?: string;
  name: string;
  enabled: boolean;
  pfwd_interface: string;
  src: string;
  dst_port: string;
  fwd: string;
  fwd_port: string;
  proto: string;
  log: boolean;
}

export interface FirewallRule {
  _id?: string;
  name: string;
  enabled: boolean;
  ruleset: string;
  rule_index: number;
  action: string;
  protocol: string;
  src_firewallgroup_ids: string[];
  dst_address: string;
  dst_port: string;
  logging: boolean;
}

export interface UnifiClient {
  login(): Promise<void>;
  createDnatRule(rule: Omit<DnatRule, "_id">): Promise<string>;
  updateDnatRule(id: string, rule: Partial<DnatRule>): Promise<void>;
  deleteDnatRule(id: string): Promise<void>;
  getDnatRule(id: string): Promise<DnatRule | null>;
  createFirewallRule(rule: Omit<FirewallRule, "_id">): Promise<string>;
  updateFirewallRule(id: string, rule: Partial<FirewallRule>): Promise<void>;
  deleteFirewallRule(id: string): Promise<void>;
  getFirewallRule(id: string): Promise<FirewallRule | null>;
}
```

- [ ] **Step 2: Write UniFi client tests**

```typescript
// tests/unifi/client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUnifiClient } from "../src/unifi/client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("UnifiClient", () => {
  const client = createUnifiClient({
    host: "https://192.168.1.1",
    username: "admin",
    password: "pass",
    vpnInterface: "wg0",
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("logs in and stores cookie", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "set-cookie": "TOKEN=abc123; Path=/" }),
      json: async () => ({}),
    });

    await client.login();
    expect(mockFetch).toHaveBeenCalledWith(
      "https://192.168.1.1/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "pass" }),
      })
    );
  });

  it("creates a DNAT rule and returns ID", async () => {
    // Login first
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "set-cookie": "TOKEN=abc123; Path=/" }),
      json: async () => ({}),
    });
    await client.login();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ _id: "dnat-rule-123", name: "VPM: Plex" }],
      }),
    });

    const id = await client.createDnatRule({
      name: "VPM: Plex",
      enabled: true,
      pfwd_interface: "wg0",
      src: "any",
      dst_port: "58216",
      fwd: "10.0.17.249",
      fwd_port: "32400",
      proto: "tcp_udp",
      log: false,
    });

    expect(id).toBe("dnat-rule-123");
  });

  it("deletes a DNAT rule", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "set-cookie": "TOKEN=abc123; Path=/" }),
      json: async () => ({}),
    });
    await client.login();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });

    await client.deleteDnatRule("dnat-rule-123");
    expect(mockFetch).toHaveBeenLastCalledWith(
      "https://192.168.1.1/proxy/network/api/s/default/rest/nat/dnat-rule-123",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("creates a firewall rule and returns ID", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "set-cookie": "TOKEN=abc123; Path=/" }),
      json: async () => ({}),
    });
    await client.login();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ _id: "fw-rule-456", name: "VPM: Allow Plex" }],
      }),
    });

    const id = await client.createFirewallRule({
      name: "VPM: Allow Plex",
      enabled: true,
      ruleset: "WAN_IN",
      rule_index: 20000,
      action: "accept",
      protocol: "tcp_udp",
      src_firewallgroup_ids: [],
      dst_address: "10.0.17.249",
      dst_port: "32400",
      logging: false,
    });

    expect(id).toBe("fw-rule-456");
  });

  it("returns null for non-existent rule", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "set-cookie": "TOKEN=abc123; Path=/" }),
      json: async () => ({}),
    });
    await client.login();

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    const rule = await client.getDnatRule("nonexistent");
    expect(rule).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm vitest run tests/unifi/client.test.ts
```

Expected: FAIL -- `src/unifi/client.ts` doesn't exist yet.

- [ ] **Step 4: Implement UniFi client**

```typescript
// src/unifi/client.ts
import type { UnifiClient, DnatRule, FirewallRule } from "./types.js";

interface UnifiClientConfig {
  host: string;
  username: string;
  password: string;
  vpnInterface: string;
}

export function createUnifiClient(config: UnifiClientConfig): UnifiClient {
  let cookie = "";
  const baseUrl = config.host.replace(/\/$/, "");
  const apiBase = `${baseUrl}/proxy/network/api/s/default`;

  async function request(path: string, opts: RequestInit = {}): Promise<any> {
    const res = await fetch(`${apiBase}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...opts.headers,
      },
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`UniFi API error (${res.status}): ${res.statusText}`);
    }
    return res.json();
  }

  return {
    async login() {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: config.username,
          password: config.password,
        }),
      });
      if (!res.ok) {
        throw new Error(`UniFi login failed (${res.status}): ${res.statusText}`);
      }
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        cookie = setCookie.split(";")[0];
      }
    },

    async createDnatRule(rule) {
      const body = await request("/rest/nat", {
        method: "POST",
        body: JSON.stringify(rule),
      });
      return body.data[0]._id;
    },

    async updateDnatRule(id, rule) {
      await request(`/rest/nat/${id}`, {
        method: "PUT",
        body: JSON.stringify(rule),
      });
    },

    async deleteDnatRule(id) {
      await request(`/rest/nat/${id}`, { method: "DELETE" });
    },

    async getDnatRule(id) {
      const body = await request(`/rest/nat/${id}`, { method: "GET" });
      if (!body || !body.data?.[0]) return null;
      return body.data[0];
    },

    async createFirewallRule(rule) {
      const body = await request("/rest/firewallrule", {
        method: "POST",
        body: JSON.stringify(rule),
      });
      return body.data[0]._id;
    },

    async updateFirewallRule(id, rule) {
      await request(`/rest/firewallrule/${id}`, {
        method: "PUT",
        body: JSON.stringify(rule),
      });
    },

    async deleteFirewallRule(id) {
      await request(`/rest/firewallrule/${id}`, { method: "DELETE" });
    },

    async getFirewallRule(id) {
      const body = await request(`/rest/firewallrule/${id}`, { method: "GET" });
      if (!body || !body.data?.[0]) return null;
      return body.data[0];
    },
  };
}
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
pnpm vitest run tests/unifi/client.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/unifi/ tests/unifi/
git commit -m "feat: UniFi API client for DNAT and firewall rule management"
```

---

### Task 5: Hook System

**Files:**
- Create: `src/hooks/types.ts`
- Create: `src/hooks/runner.ts`
- Create: `src/hooks/plugins/plex.ts`
- Create: `tests/hooks/runner.test.ts`
- Create: `tests/hooks/plugins/plex.test.ts`

- [ ] **Step 1: Create hook types**

```typescript
// src/hooks/types.ts
export interface HookPayload {
  mappingId: string;
  label: string;
  oldPort: number | null;
  newPort: number | null;
  destIp: string;
  destPort: number;
}

export interface HookResult {
  success: boolean;
  error?: string;
}

export interface HookPlugin {
  name: string;
  execute(config: Record<string, any>, payload: HookPayload): Promise<HookResult>;
}
```

- [ ] **Step 2: Write hook runner tests**

```typescript
// tests/hooks/runner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHookRunner } from "../src/hooks/runner.js";
import type { HookPayload } from "../src/hooks/types.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("HookRunner", () => {
  const runner = createHookRunner();
  const payload: HookPayload = {
    mappingId: "abc-123",
    label: "Plex",
    oldPort: 58216,
    newPort: 59000,
    destIp: "10.0.17.249",
    destPort: 32400,
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("executes a webhook hook", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await runner.execute(
      { type: "webhook", config: JSON.stringify({ url: "http://example.com/hook", method: "POST" }) },
      payload
    );
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://example.com/hook",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      })
    );
  });

  it("executes a command hook with template substitution", async () => {
    const { execSync } = await import("child_process");
    const runner = createHookRunner();

    // We can't easily test command execution in unit tests without mocking child_process,
    // so test the template substitution logic directly
    const result = await runner.resolveTemplate(
      "/scripts/update.sh {{newPort}} {{destIp}}",
      payload
    );
    expect(result).toBe("/scripts/update.sh 59000 10.0.17.249");
  });

  it("returns error for webhook failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Internal Server Error" });

    const result = await runner.execute(
      { type: "webhook", config: JSON.stringify({ url: "http://example.com/hook" }) },
      payload
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
  });

  it("returns error for unknown plugin", async () => {
    const result = await runner.execute(
      { type: "plugin", config: JSON.stringify({ plugin: "nonexistent" }) },
      payload
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown plugin");
  });
});
```

- [ ] **Step 3: Write Plex plugin test**

```typescript
// tests/hooks/plugins/plex.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { plexPlugin } from "../src/hooks/plugins/plex.js";
import type { HookPayload } from "../src/hooks/types.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("PlexPlugin", () => {
  const payload: HookPayload = {
    mappingId: "abc-123",
    label: "Plex",
    oldPort: 58216,
    newPort: 59000,
    destIp: "10.0.17.249",
    destPort: 32400,
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("updates Plex manual port", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await plexPlugin.execute(
      { host: "http://10.0.17.249:32400", token: "plex-token" },
      payload
    );
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://10.0.17.249:32400/:/prefs?ManualPortMappingPort=59000&X-Plex-Token=plex-token",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("skips when newPort is null (deletion)", async () => {
    const result = await plexPlugin.execute(
      { host: "http://10.0.17.249:32400", token: "plex-token" },
      { ...payload, newPort: null }
    );
    expect(result.success).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns error on Plex API failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" });

    const result = await plexPlugin.execute(
      { host: "http://10.0.17.249:32400", token: "bad-token" },
      payload
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("401");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
pnpm vitest run tests/hooks/
```

Expected: FAIL -- source files don't exist yet.

- [ ] **Step 5: Implement Plex plugin**

```typescript
// src/hooks/plugins/plex.ts
import type { HookPlugin, HookPayload, HookResult } from "../types.js";

export const plexPlugin: HookPlugin = {
  name: "plex",

  async execute(config: Record<string, any>, payload: HookPayload): Promise<HookResult> {
    if (payload.newPort === null) {
      return { success: true }; // Nothing to do on deletion
    }

    const { host, token } = config;
    const url = `${host}/:/prefs?ManualPortMappingPort=${payload.newPort}&X-Plex-Token=${token}`;

    try {
      const res = await fetch(url, { method: "PUT" });
      if (!res.ok) {
        return { success: false, error: `Plex API error (${res.status}): ${res.statusText}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: `Plex connection error: ${(err as Error).message}` };
    }
  },
};
```

- [ ] **Step 6: Implement hook runner**

```typescript
// src/hooks/runner.ts
import { execSync } from "child_process";
import type { HookPayload, HookResult, HookPlugin } from "./types.js";
import { plexPlugin } from "./plugins/plex.js";

const plugins: Record<string, HookPlugin> = {
  plex: plexPlugin,
};

export interface HookDef {
  type: string;
  config: string;
}

export interface HookRunner {
  execute(hook: HookDef, payload: HookPayload): Promise<HookResult>;
  resolveTemplate(template: string, payload: HookPayload): string;
}

export function createHookRunner(): HookRunner {
  function resolveTemplate(template: string, payload: HookPayload): string {
    return template
      .replace(/\{\{mappingId\}\}/g, payload.mappingId)
      .replace(/\{\{label\}\}/g, payload.label)
      .replace(/\{\{oldPort\}\}/g, String(payload.oldPort ?? ""))
      .replace(/\{\{newPort\}\}/g, String(payload.newPort ?? ""))
      .replace(/\{\{destIp\}\}/g, payload.destIp)
      .replace(/\{\{destPort\}\}/g, String(payload.destPort));
  }

  return {
    resolveTemplate,

    async execute(hook: HookDef, payload: HookPayload): Promise<HookResult> {
      const config = JSON.parse(hook.config);

      switch (hook.type) {
        case "plugin": {
          const plugin = plugins[config.plugin];
          if (!plugin) {
            return { success: false, error: `Unknown plugin: ${config.plugin}` };
          }
          return plugin.execute(config, payload);
        }

        case "webhook": {
          try {
            const res = await fetch(config.url, {
              method: config.method ?? "POST",
              headers: {
                "Content-Type": "application/json",
                ...(config.headers ?? {}),
              },
              body: JSON.stringify(payload),
            });
            if (!res.ok) {
              return { success: false, error: `Webhook error (${res.status}): ${res.statusText}` };
            }
            return { success: true };
          } catch (err) {
            return { success: false, error: `Webhook failed: ${(err as Error).message}` };
          }
        }

        case "command": {
          try {
            const cmd = resolveTemplate(config.command, payload);
            execSync(cmd, { timeout: 30000, stdio: "pipe" });
            return { success: true };
          } catch (err) {
            return { success: false, error: `Command failed: ${(err as Error).message}` };
          }
        }

        default:
          return { success: false, error: `Unknown hook type: ${hook.type}` };
      }
    },
  };
}
```

- [ ] **Step 7: Run tests and verify they pass**

```bash
pnpm vitest run tests/hooks/
```

Expected: All 7 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/ tests/hooks/
git commit -m "feat: hook system with webhook, command, and Plex plugin support"
```

---

### Task 6: Sync Watchdog

**Files:**
- Create: `src/sync.ts`
- Create: `tests/sync.test.ts`

- [ ] **Step 1: Write sync watchdog tests**

```typescript
// tests/sync.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDb, type Db } from "../src/db.js";
import { createSyncWatchdog } from "../src/sync.js";
import type { VpnProvider } from "../src/providers/types.js";
import type { UnifiClient } from "../src/unifi/types.js";

function mockProvider(ports: { port: number; expiresAt: number }[] = []): VpnProvider {
  return {
    name: "azire",
    maxPorts: 5,
    listPorts: vi.fn().mockResolvedValue(ports),
    createPort: vi.fn().mockResolvedValue({ port: 60000, expiresAt: 9999999999 }),
    deletePort: vi.fn().mockResolvedValue(undefined),
    checkPort: vi.fn().mockResolvedValue(true),
  };
}

function mockUnifi(): UnifiClient {
  return {
    login: vi.fn().mockResolvedValue(undefined),
    createDnatRule: vi.fn().mockResolvedValue("dnat-new"),
    updateDnatRule: vi.fn().mockResolvedValue(undefined),
    deleteDnatRule: vi.fn().mockResolvedValue(undefined),
    getDnatRule: vi.fn().mockResolvedValue({ _id: "dnat-1" }),
    createFirewallRule: vi.fn().mockResolvedValue("fw-new"),
    updateFirewallRule: vi.fn().mockResolvedValue(undefined),
    deleteFirewallRule: vi.fn().mockResolvedValue(undefined),
    getFirewallRule: vi.fn().mockResolvedValue({ _id: "fw-1" }),
  };
}

describe("SyncWatchdog", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("detects and removes expired ports not on provider", async () => {
    const mappingId = db.createMapping({
      provider: "azire",
      vpnPort: 58216,
      destIp: "10.0.17.249",
      destPort: 32400,
      protocol: "tcp",
      label: "Plex",
      status: "active",
      expiresAt: 1687434503,
    });
    db.updateMapping(mappingId, { unifiDnatId: "dnat-1", unifiFirewallId: "fw-1" });

    const provider = mockProvider([]); // port not in provider list
    const unifi = mockUnifi();
    const watchdog = createSyncWatchdog({ db, provider, unifi, renewThresholdDays: 30 });

    await watchdog.runOnce();

    const mapping = db.getMapping(mappingId);
    expect(mapping!.status).toBe("expired");
    expect(unifi.deleteDnatRule).toHaveBeenCalledWith("dnat-1");
    expect(unifi.deleteFirewallRule).toHaveBeenCalledWith("fw-1");
  });

  it("auto-renews ports expiring soon", async () => {
    const soonExpiry = Math.floor(Date.now() / 1000) + 86400 * 10; // 10 days from now
    const mappingId = db.createMapping({
      provider: "azire",
      vpnPort: 58216,
      destIp: "10.0.17.249",
      destPort: 32400,
      protocol: "tcp",
      label: "Plex",
      status: "active",
      expiresAt: soonExpiry,
    });
    db.updateMapping(mappingId, { unifiDnatId: "dnat-1", unifiFirewallId: "fw-1" });

    const provider = mockProvider([{ port: 58216, expiresAt: soonExpiry }]);
    const unifi = mockUnifi();
    const watchdog = createSyncWatchdog({ db, provider, unifi, renewThresholdDays: 30 });

    await watchdog.runOnce();

    // Should have deleted old port and created new one
    expect(provider.deletePort).toHaveBeenCalledWith(58216);
    expect(provider.createPort).toHaveBeenCalled();

    const mapping = db.getMapping(mappingId);
    expect(mapping!.vpnPort).toBe(60000); // new port from mock
  });

  it("re-creates missing UniFi rules", async () => {
    const futureExpiry = Math.floor(Date.now() / 1000) + 86400 * 300;
    const mappingId = db.createMapping({
      provider: "azire",
      vpnPort: 58216,
      destIp: "10.0.17.249",
      destPort: 32400,
      protocol: "tcp",
      label: "Plex",
      status: "active",
      expiresAt: futureExpiry,
    });
    db.updateMapping(mappingId, { unifiDnatId: "dnat-1", unifiFirewallId: "fw-1" });

    const provider = mockProvider([{ port: 58216, expiresAt: futureExpiry }]);
    const unifi = mockUnifi();
    (unifi.getDnatRule as any).mockResolvedValue(null); // Rule missing

    const watchdog = createSyncWatchdog({ db, provider, unifi, renewThresholdDays: 30 });
    await watchdog.runOnce();

    expect(unifi.createDnatRule).toHaveBeenCalled();
    const mapping = db.getMapping(mappingId);
    expect(mapping!.unifiDnatId).toBe("dnat-new");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run tests/sync.test.ts
```

Expected: FAIL -- `src/sync.ts` doesn't exist yet.

- [ ] **Step 3: Implement sync watchdog**

```typescript
// src/sync.ts
import type { Db } from "./db.js";
import type { VpnProvider } from "./providers/types.js";
import type { UnifiClient } from "./unifi/types.js";
import { createHookRunner } from "./hooks/runner.js";
import type { HookPayload } from "./hooks/types.js";

interface SyncConfig {
  db: Db;
  provider: VpnProvider;
  unifi: UnifiClient;
  renewThresholdDays: number;
}

export interface SyncWatchdog {
  runOnce(): Promise<void>;
  start(intervalMs: number): void;
  stop(): void;
}

export function createSyncWatchdog(config: SyncConfig): SyncWatchdog {
  const { db, provider, unifi, renewThresholdDays } = config;
  const hookRunner = createHookRunner();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function fireHooks(mappingId: string, payload: HookPayload) {
    const hooks = db.listHooks(mappingId);
    for (const hook of hooks) {
      const result = await hookRunner.execute(hook, payload);
      db.updateHookStatus(hook.id, result.success ? "success" : "error", result.error);
      db.logSync("hook_fired", mappingId, {
        hookId: hook.id,
        type: hook.type,
        success: result.success,
        error: result.error,
      });
    }
  }

  async function checkProviderSync() {
    const providerPorts = await provider.listPorts();
    const providerPortSet = new Set(providerPorts.map((p) => p.port));
    const mappings = db.listMappings();

    for (const mapping of mappings) {
      if (mapping.status === "expired") continue;

      if (!providerPortSet.has(mapping.vpnPort)) {
        // Port disappeared from provider
        db.updateMapping(mapping.id, { status: "expired" });
        if (mapping.unifiDnatId) {
          try { await unifi.deleteDnatRule(mapping.unifiDnatId); } catch {}
        }
        if (mapping.unifiFirewallId) {
          try { await unifi.deleteFirewallRule(mapping.unifiFirewallId); } catch {}
        }
        await fireHooks(mapping.id, {
          mappingId: mapping.id,
          label: mapping.label,
          oldPort: mapping.vpnPort,
          newPort: null,
          destIp: mapping.destIp,
          destPort: mapping.destPort,
        });
        db.logSync("sync_fix", mapping.id, { reason: "port_missing_from_provider" });
      }
    }
  }

  async function checkRenewals() {
    const now = Math.floor(Date.now() / 1000);
    const threshold = now + renewThresholdDays * 86400;
    const mappings = db.listMappings();

    for (const mapping of mappings) {
      if (mapping.status !== "active") continue;
      if (mapping.expiresAt > threshold) continue;

      // Port expiring soon -- renew
      const oldPort = mapping.vpnPort;
      try {
        await provider.deletePort(oldPort);
        const newProviderPort = await provider.createPort({ expiresInDays: 365 });

        db.updateMapping(mapping.id, {
          vpnPort: newProviderPort.port,
          expiresAt: newProviderPort.expiresAt,
        });

        // Update UniFi rules if port changed
        if (newProviderPort.port !== oldPort) {
          if (mapping.unifiDnatId) {
            await unifi.updateDnatRule(mapping.unifiDnatId, { dst_port: String(newProviderPort.port) });
          }
          if (mapping.unifiFirewallId) {
            await unifi.updateFirewallRule(mapping.unifiFirewallId, { dst_port: String(newProviderPort.port) });
          }
          await fireHooks(mapping.id, {
            mappingId: mapping.id,
            label: mapping.label,
            oldPort,
            newPort: newProviderPort.port,
            destIp: mapping.destIp,
            destPort: mapping.destPort,
          });
        }

        db.logSync("renew", mapping.id, { oldPort, newPort: newProviderPort.port });
      } catch (err) {
        db.logSync("renew", mapping.id, { error: (err as Error).message });
      }
    }
  }

  async function checkUnifiRules() {
    const mappings = db.listMappings();

    for (const mapping of mappings) {
      if (mapping.status !== "active") continue;

      // Check DNAT rule exists
      if (mapping.unifiDnatId) {
        const rule = await unifi.getDnatRule(mapping.unifiDnatId);
        if (!rule) {
          const newId = await unifi.createDnatRule({
            name: `VPM: ${mapping.label}`,
            enabled: true,
            pfwd_interface: "",
            src: "any",
            dst_port: String(mapping.vpnPort),
            fwd: mapping.destIp,
            fwd_port: String(mapping.destPort),
            proto: mapping.protocol === "both" ? "tcp_udp" : mapping.protocol,
            log: false,
          });
          db.updateMapping(mapping.id, { unifiDnatId: newId });
          db.logSync("sync_fix", mapping.id, { reason: "dnat_rule_recreated" });
        }
      }

      // Check firewall rule exists
      if (mapping.unifiFirewallId) {
        const rule = await unifi.getFirewallRule(mapping.unifiFirewallId);
        if (!rule) {
          const newId = await unifi.createFirewallRule({
            name: `VPM: Allow ${mapping.label}`,
            enabled: true,
            ruleset: "WAN_IN",
            rule_index: 20000,
            action: "accept",
            protocol: mapping.protocol === "both" ? "tcp_udp" : mapping.protocol,
            src_firewallgroup_ids: [],
            dst_address: mapping.destIp,
            dst_port: String(mapping.destPort),
            logging: false,
          });
          db.updateMapping(mapping.id, { unifiFirewallId: newId });
          db.logSync("sync_fix", mapping.id, { reason: "firewall_rule_recreated" });
        }
      }
    }
  }

  async function retryFailedHooks() {
    const mappings = db.listMappings();
    for (const mapping of mappings) {
      if (mapping.status !== "active") continue;
      const hooks = db.listHooks(mapping.id);
      for (const hook of hooks) {
        if (hook.lastStatus === "error") {
          const payload: HookPayload = {
            mappingId: mapping.id,
            label: mapping.label,
            oldPort: null,
            newPort: mapping.vpnPort,
            destIp: mapping.destIp,
            destPort: mapping.destPort,
          };
          const result = await hookRunner.execute(hook, payload);
          db.updateHookStatus(hook.id, result.success ? "success" : "error", result.error);
        }
      }
    }
  }

  return {
    async runOnce() {
      try {
        await unifi.login();
      } catch (err) {
        db.logSync("sync_fix", null, { error: `UniFi login failed: ${(err as Error).message}` });
        return;
      }
      await checkProviderSync();
      await checkRenewals();
      await checkUnifiRules();
      await retryFailedHooks();
    },

    start(intervalMs: number) {
      if (timer) return;
      timer = setInterval(() => {
        this.runOnce().catch((err) => {
          console.error("Sync watchdog error:", err);
        });
      }, intervalMs);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
pnpm vitest run tests/sync.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync.ts tests/sync.test.ts
git commit -m "feat: sync watchdog for auto-renewal, drift detection, and hook retry"
```

---

### Task 7: REST API Routes

**Files:**
- Create: `src/routes/api.ts`
- Create: `tests/routes/api.test.ts`

- [ ] **Step 1: Write API route tests**

```typescript
// tests/routes/api.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createDb, type Db } from "../src/db.js";
import { createApiRoutes } from "../src/routes/api.js";
import type { VpnProvider } from "../src/providers/types.js";
import type { UnifiClient } from "../src/unifi/types.js";

function mockProvider(): VpnProvider {
  return {
    name: "azire",
    maxPorts: 5,
    listPorts: vi.fn().mockResolvedValue([]),
    createPort: vi.fn().mockResolvedValue({ port: 58216, expiresAt: 9999999999 }),
    deletePort: vi.fn().mockResolvedValue(undefined),
    checkPort: vi.fn().mockResolvedValue(true),
  };
}

function mockUnifi(): UnifiClient {
  return {
    login: vi.fn().mockResolvedValue(undefined),
    createDnatRule: vi.fn().mockResolvedValue("dnat-123"),
    updateDnatRule: vi.fn().mockResolvedValue(undefined),
    deleteDnatRule: vi.fn().mockResolvedValue(undefined),
    getDnatRule: vi.fn().mockResolvedValue(null),
    createFirewallRule: vi.fn().mockResolvedValue("fw-456"),
    updateFirewallRule: vi.fn().mockResolvedValue(undefined),
    deleteFirewallRule: vi.fn().mockResolvedValue(undefined),
    getFirewallRule: vi.fn().mockResolvedValue(null),
  };
}

describe("API Routes", () => {
  let db: Db;
  let app: Hono;
  let provider: VpnProvider;
  let unifi: UnifiClient;

  beforeEach(() => {
    db = createDb(":memory:");
    provider = mockProvider();
    unifi = mockUnifi();
    app = new Hono();
    app.route("/api", createApiRoutes({ db, provider, unifi, vpnInterface: "wg0" }));
  });

  afterEach(() => {
    db.close();
  });

  it("GET /api/mappings returns empty list", async () => {
    const res = await app.request("/api/mappings");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mappings).toEqual([]);
  });

  it("POST /api/mappings creates a mapping with UniFi rules", async () => {
    const res = await app.request("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destIp: "10.0.17.249",
        destPort: 32400,
        protocol: "tcp",
        label: "Plex",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.mapping.vpnPort).toBe(58216);
    expect(body.mapping.status).toBe("active");
    expect(body.mapping.unifiDnatId).toBe("dnat-123");
    expect(body.mapping.unifiFirewallId).toBe("fw-456");
    expect(provider.createPort).toHaveBeenCalled();
    expect(unifi.createDnatRule).toHaveBeenCalled();
    expect(unifi.createFirewallRule).toHaveBeenCalled();
  });

  it("DELETE /api/mappings/:id removes mapping and UniFi rules", async () => {
    // Create first
    const createRes = await app.request("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destIp: "10.0.17.249",
        destPort: 32400,
        protocol: "tcp",
        label: "Plex",
      }),
    });
    const { mapping } = await createRes.json();

    const res = await app.request(`/api/mappings/${mapping.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(provider.deletePort).toHaveBeenCalledWith(58216);
    expect(unifi.deleteDnatRule).toHaveBeenCalledWith("dnat-123");
    expect(unifi.deleteFirewallRule).toHaveBeenCalledWith("fw-456");
  });

  it("GET /api/status returns health info", async () => {
    (provider.listPorts as any).mockResolvedValue([{ port: 58216, expiresAt: 9999999999 }]);
    const res = await app.request("/api/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("provider");
    expect(body).toHaveProperty("unifi");
  });

  it("POST /api/mappings rejects when max ports reached", async () => {
    // Fill up to max
    for (let i = 0; i < 5; i++) {
      (provider.createPort as any).mockResolvedValueOnce({ port: 58200 + i, expiresAt: 9999999999 });
      await app.request("/api/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destIp: "10.0.17.249", destPort: 32400 + i, protocol: "tcp", label: `svc-${i}` }),
      });
    }

    const res = await app.request("/api/mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destIp: "10.0.17.249", destPort: 9999, protocol: "tcp", label: "overflow" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("maximum");
  });

  it("GET /api/logs returns sync log entries", async () => {
    db.logSync("create", null, { test: true });
    const res = await app.request("/api/logs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run tests/routes/api.test.ts
```

Expected: FAIL -- `src/routes/api.ts` doesn't exist yet.

- [ ] **Step 3: Implement API routes**

```typescript
// src/routes/api.ts
import { Hono } from "hono";
import type { Db } from "../db.js";
import type { VpnProvider } from "../providers/types.js";
import type { UnifiClient } from "../unifi/types.js";
import { createHookRunner } from "../hooks/runner.js";
import type { HookPayload } from "../hooks/types.js";

interface ApiRoutesConfig {
  db: Db;
  provider: VpnProvider;
  unifi: UnifiClient;
  vpnInterface: string;
}

export function createApiRoutes(config: ApiRoutesConfig): Hono {
  const { db, provider, unifi, vpnInterface } = config;
  const hookRunner = createHookRunner();
  const api = new Hono();

  async function fireHooks(mappingId: string, payload: HookPayload) {
    const hooks = db.listHooks(mappingId);
    for (const hook of hooks) {
      const result = await hookRunner.execute(hook, payload);
      db.updateHookStatus(hook.id, result.success ? "success" : "error", result.error);
      db.logSync("hook_fired", mappingId, {
        hookId: hook.id,
        type: hook.type,
        success: result.success,
      });
    }
  }

  api.get("/mappings", (c) => {
    const mappings = db.listMappings().map((m) => ({
      ...m,
      hooks: db.listHooks(m.id),
    }));
    return c.json({ mappings });
  });

  api.post("/mappings", async (c) => {
    const body = await c.req.json();
    const { destIp, destPort, protocol, label, hooks: hookDefs } = body;

    // Check max ports
    const existing = db.listMappings().filter((m) => m.status === "active");
    if (existing.length >= provider.maxPorts) {
      return c.json({ error: `Cannot exceed maximum of ${provider.maxPorts} ports` }, 400);
    }

    // Request port from provider
    const providerPort = await provider.createPort({ expiresInDays: 365 });

    // Store in DB
    const mappingId = db.createMapping({
      provider: provider.name,
      vpnPort: providerPort.port,
      destIp,
      destPort,
      protocol: protocol ?? "both",
      label: label ?? "",
      status: "pending",
      expiresAt: providerPort.expiresAt,
    });

    // Create UniFi rules
    try {
      await unifi.login();

      const dnatId = await unifi.createDnatRule({
        name: `VPM: ${label}`,
        enabled: true,
        pfwd_interface: vpnInterface,
        src: "any",
        dst_port: String(providerPort.port),
        fwd: destIp,
        fwd_port: String(destPort),
        proto: protocol === "both" || !protocol ? "tcp_udp" : protocol,
        log: false,
      });

      const fwId = await unifi.createFirewallRule({
        name: `VPM: Allow ${label}`,
        enabled: true,
        ruleset: "WAN_IN",
        rule_index: 20000,
        action: "accept",
        protocol: protocol === "both" || !protocol ? "tcp_udp" : protocol,
        src_firewallgroup_ids: [],
        dst_address: destIp,
        dst_port: String(destPort),
        logging: false,
      });

      db.updateMapping(mappingId, {
        status: "active",
        unifiDnatId: dnatId,
        unifiFirewallId: fwId,
      });
    } catch (err) {
      db.updateMapping(mappingId, { status: "error" });
      db.logSync("create", mappingId, { error: (err as Error).message });
    }

    // Create hooks if provided
    if (hookDefs && Array.isArray(hookDefs)) {
      for (const h of hookDefs) {
        db.createHook({
          mappingId,
          type: h.type,
          config: typeof h.config === "string" ? h.config : JSON.stringify(h.config),
        });
      }
    }

    const mapping = db.getMapping(mappingId)!;
    db.logSync("create", mappingId, { vpnPort: mapping.vpnPort });

    // Fire hooks
    await fireHooks(mappingId, {
      mappingId,
      label: mapping.label,
      oldPort: null,
      newPort: mapping.vpnPort,
      destIp: mapping.destIp,
      destPort: mapping.destPort,
    });

    return c.json({ mapping: { ...mapping, hooks: db.listHooks(mappingId) } }, 201);
  });

  api.put("/mappings/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const existing = db.getMapping(id);
    if (!existing) return c.json({ error: "Not found" }, 404);

    const { destIp, destPort, protocol, label, hooks: hookDefs } = body;
    const updates: any = {};
    if (destIp !== undefined) updates.destIp = destIp;
    if (destPort !== undefined) updates.destPort = destPort;
    if (protocol !== undefined) updates.protocol = protocol;
    if (label !== undefined) updates.label = label;

    db.updateMapping(id, updates);

    // Update UniFi rules if destination changed
    if ((destIp || destPort) && existing.unifiDnatId) {
      try {
        await unifi.login();
        await unifi.updateDnatRule(existing.unifiDnatId, {
          fwd: destIp ?? existing.destIp,
          fwd_port: String(destPort ?? existing.destPort),
        });
        if (existing.unifiFirewallId) {
          await unifi.updateFirewallRule(existing.unifiFirewallId, {
            dst_address: destIp ?? existing.destIp,
            dst_port: String(destPort ?? existing.destPort),
          });
        }
      } catch (err) {
        db.logSync("sync_fix", id, { error: (err as Error).message });
      }
    }

    // Replace hooks if provided
    if (hookDefs && Array.isArray(hookDefs)) {
      const oldHooks = db.listHooks(id);
      for (const h of oldHooks) db.deleteHook(h.id);
      for (const h of hookDefs) {
        db.createHook({
          mappingId: id,
          type: h.type,
          config: typeof h.config === "string" ? h.config : JSON.stringify(h.config),
        });
      }
    }

    const mapping = db.getMapping(id)!;
    return c.json({ mapping: { ...mapping, hooks: db.listHooks(id) } });
  });

  api.delete("/mappings/:id", async (c) => {
    const id = c.req.param("id");
    const mapping = db.getMapping(id);
    if (!mapping) return c.json({ error: "Not found" }, 404);

    // Delete from provider
    try {
      await provider.deletePort(mapping.vpnPort);
    } catch {}

    // Delete UniFi rules
    try {
      await unifi.login();
      if (mapping.unifiDnatId) await unifi.deleteDnatRule(mapping.unifiDnatId);
      if (mapping.unifiFirewallId) await unifi.deleteFirewallRule(mapping.unifiFirewallId);
    } catch {}

    // Fire hooks before deletion
    await fireHooks(id, {
      mappingId: id,
      label: mapping.label,
      oldPort: mapping.vpnPort,
      newPort: null,
      destIp: mapping.destIp,
      destPort: mapping.destPort,
    });

    db.deleteMapping(id);
    db.logSync("delete", id, { vpnPort: mapping.vpnPort });

    return c.json({ success: true });
  });

  api.post("/mappings/:id/refresh", async (c) => {
    const id = c.req.param("id");
    const mapping = db.getMapping(id);
    if (!mapping) return c.json({ error: "Not found" }, 404);

    // Verify port still exists on provider
    const exists = await provider.checkPort(mapping.vpnPort);
    if (!exists) {
      db.updateMapping(id, { status: "expired" });
      return c.json({ mapping: db.getMapping(id), warning: "Port no longer exists on provider" });
    }

    return c.json({ mapping: { ...db.getMapping(id)!, hooks: db.listHooks(id) } });
  });

  api.get("/status", async (c) => {
    let providerOk = false;
    let providerPorts = 0;
    try {
      const ports = await provider.listPorts();
      providerOk = true;
      providerPorts = ports.length;
    } catch {}

    let unifiOk = false;
    try {
      await unifi.login();
      unifiOk = true;
    } catch {}

    const mappings = db.listMappings();
    const logs = db.getRecentLogs(1);

    return c.json({
      provider: { connected: providerOk, name: provider.name, activePorts: providerPorts, maxPorts: provider.maxPorts },
      unifi: { connected: unifiOk },
      mappings: { total: mappings.length, active: mappings.filter((m) => m.status === "active").length },
      lastSync: logs[0]?.timestamp ?? null,
    });
  });

  api.get("/logs", (c) => {
    const limit = Number(c.req.query("limit") ?? 50);
    const logs = db.getRecentLogs(limit);
    return c.json({ logs });
  });

  return api;
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
pnpm vitest run tests/routes/api.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api.ts tests/routes/api.test.ts
git commit -m "feat: REST API routes for mapping CRUD, status, and logs"
```

---

### Task 8: Web UI Views

**Files:**
- Create: `src/views/layout.ts`
- Create: `src/views/dashboard.ts`
- Create: `src/views/create.ts`
- Create: `src/views/edit.ts`
- Create: `src/views/logs.ts`
- Create: `src/routes/ui.ts`

- [ ] **Step 1: Create layout wrapper**

```typescript
// src/views/layout.ts
export function layout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - VPN Port Manager</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1117; color: #e1e4e8; line-height: 1.6; }
    .container { max-width: 960px; margin: 0 auto; padding: 1rem; }
    nav { background: #161b22; border-bottom: 1px solid #30363d; padding: 0.75rem 1rem; margin-bottom: 1.5rem; }
    nav a { color: #58a6ff; text-decoration: none; margin-right: 1.5rem; font-weight: 500; }
    nav a:hover { text-decoration: underline; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    h2 { font-size: 1.2rem; margin-bottom: 0.75rem; color: #c9d1d9; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
    .badge-active { background: #238636; color: #fff; }
    .badge-pending { background: #9e6a03; color: #fff; }
    .badge-error { background: #da3633; color: #fff; }
    .badge-expired { background: #484f58; color: #c9d1d9; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #30363d; }
    th { color: #8b949e; font-weight: 600; font-size: 0.85rem; text-transform: uppercase; }
    form label { display: block; margin-bottom: 0.25rem; color: #c9d1d9; font-weight: 500; }
    form input, form select { width: 100%; padding: 0.5rem; background: #0d1117; border: 1px solid #30363d; border-radius: 4px; color: #e1e4e8; margin-bottom: 0.75rem; }
    .btn { display: inline-block; padding: 0.5rem 1rem; border-radius: 6px; border: none; cursor: pointer; font-weight: 500; text-decoration: none; font-size: 0.875rem; }
    .btn-primary { background: #238636; color: #fff; }
    .btn-danger { background: #da3633; color: #fff; }
    .btn-secondary { background: #30363d; color: #c9d1d9; }
    .btn:hover { opacity: 0.9; }
    .health { display: flex; gap: 1rem; margin-bottom: 1.5rem; }
    .health-item { flex: 1; }
    .health-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 0.4rem; }
    .health-dot-ok { background: #3fb950; }
    .health-dot-err { background: #f85149; }
    .port-num { font-family: "SF Mono", Monaco, monospace; font-size: 1.1rem; color: #58a6ff; }
    .muted { color: #8b949e; font-size: 0.85rem; }
    .actions { display: flex; gap: 0.5rem; }
    .mb { margin-bottom: 1rem; }
  </style>
</head>
<body>
  <nav>
    <a href="/">Dashboard</a>
    <a href="/create">New Mapping</a>
    <a href="/logs">Logs</a>
  </nav>
  <div class="container">
    ${content}
  </div>
</body>
</html>`;
}
```

- [ ] **Step 2: Create dashboard view**

```typescript
// src/views/dashboard.ts
import type { PortMapping, Hook } from "../db.js";

interface StatusInfo {
  provider: { connected: boolean; name: string; activePorts: number; maxPorts: number };
  unifi: { connected: boolean };
}

function badge(status: string): string {
  return `<span class="badge badge-${status}">${status}</span>`;
}

function formatExpiry(ts: number): string {
  const d = new Date(ts * 1000);
  const days = Math.floor((ts - Date.now() / 1000) / 86400);
  if (days < 0) return "Expired";
  if (days < 30) return `${days}d left`;
  return d.toLocaleDateString();
}

export function dashboardView(
  mappings: (PortMapping & { hooks: Hook[] })[],
  status: StatusInfo
): string {
  const healthHtml = `
    <div class="health">
      <div class="card health-item">
        <span class="health-dot ${status.provider.connected ? "health-dot-ok" : "health-dot-err"}"></span>
        <strong>${status.provider.name}</strong>
        <div class="muted">${status.provider.activePorts} / ${status.provider.maxPorts} ports</div>
      </div>
      <div class="card health-item">
        <span class="health-dot ${status.unifi.connected ? "health-dot-ok" : "health-dot-err"}"></span>
        <strong>UniFi</strong>
        <div class="muted">${status.unifi.connected ? "Connected" : "Disconnected"}</div>
      </div>
    </div>`;

  const rows = mappings.map((m) => `
    <tr>
      <td><strong>${m.label || "Unnamed"}</strong></td>
      <td class="port-num">${m.vpnPort}</td>
      <td>${m.destIp}:${m.destPort}</td>
      <td>${m.protocol}</td>
      <td>${badge(m.status)}</td>
      <td class="muted">${formatExpiry(m.expiresAt)}</td>
      <td>${m.hooks.length > 0 ? m.hooks.map((h) => h.type).join(", ") : "-"}</td>
      <td class="actions">
        <a href="/edit/${m.id}" class="btn btn-secondary">Edit</a>
        <form method="POST" action="/delete/${m.id}" style="display:inline">
          <button type="submit" class="btn btn-danger" onclick="return confirm('Delete this mapping?')">Delete</button>
        </form>
      </td>
    </tr>`).join("");

  return `
    <h1>Port Mappings</h1>
    ${healthHtml}
    ${mappings.length === 0
      ? '<div class="card"><p>No port mappings yet. <a href="/create">Create one</a></p></div>'
      : `<table>
          <thead><tr>
            <th>Label</th><th>VPN Port</th><th>Destination</th><th>Protocol</th><th>Status</th><th>Expires</th><th>Hooks</th><th>Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`
    }`;
}
```

- [ ] **Step 3: Create form views**

```typescript
// src/views/create.ts
export function createView(maxPorts: number, currentCount: number): string {
  const remaining = maxPorts - currentCount;
  return `
    <h1>New Port Mapping</h1>
    <p class="muted mb">${remaining} of ${maxPorts} slots available</p>
    ${remaining <= 0
      ? '<div class="card"><p>Maximum port limit reached. Delete an existing mapping first.</p></div>'
      : `<form method="POST" action="/create" class="card">
          <label for="label">Label</label>
          <input type="text" id="label" name="label" placeholder="e.g. Plex, Nginx" required>

          <label for="destIp">Destination IP</label>
          <input type="text" id="destIp" name="destIp" placeholder="e.g. 10.0.17.249" required>

          <label for="destPort">Destination Port</label>
          <input type="number" id="destPort" name="destPort" placeholder="e.g. 32400" required>

          <label for="protocol">Protocol</label>
          <select id="protocol" name="protocol">
            <option value="both">TCP + UDP</option>
            <option value="tcp">TCP only</option>
            <option value="udp">UDP only</option>
          </select>

          <h2>Hooks (optional)</h2>
          <div id="hooks-container"></div>
          <button type="button" class="btn btn-secondary mb" onclick="addHook()">+ Add Hook</button>

          <div><button type="submit" class="btn btn-primary">Create Mapping</button></div>
        </form>
        <script>
        let hookIdx = 0;
        function addHook() {
          const c = document.getElementById('hooks-container');
          const div = document.createElement('div');
          div.className = 'card';
          div.innerHTML = \`
            <label>Type</label>
            <select name="hooks[\${hookIdx}][type]" onchange="hookTypeChanged(this, \${hookIdx})">
              <option value="plugin">Plugin</option>
              <option value="webhook">Webhook</option>
              <option value="command">Command</option>
            </select>
            <div id="hook-config-\${hookIdx}">
              <label>Plugin</label>
              <select name="hooks[\${hookIdx}][plugin]"><option value="plex">Plex</option></select>
              <label>Host</label>
              <input name="hooks[\${hookIdx}][host]" placeholder="http://10.0.17.249:32400">
              <label>Token</label>
              <input name="hooks[\${hookIdx}][token]" placeholder="Plex token">
            </div>
          \`;
          c.appendChild(div);
          hookIdx++;
        }
        function hookTypeChanged(sel, idx) {
          const div = document.getElementById('hook-config-' + idx);
          if (sel.value === 'webhook') {
            div.innerHTML = '<label>URL</label><input name="hooks['+idx+'][url]" placeholder="http://example.com/hook"><label>Method</label><select name="hooks['+idx+'][method]"><option value="POST">POST</option><option value="PUT">PUT</option></select>';
          } else if (sel.value === 'command') {
            div.innerHTML = '<label>Command</label><input name="hooks['+idx+'][command]" placeholder="/scripts/update.sh {{newPort}}">';
          } else {
            div.innerHTML = '<label>Plugin</label><select name="hooks['+idx+'][plugin]"><option value="plex">Plex</option></select><label>Host</label><input name="hooks['+idx+'][host]" placeholder="http://10.0.17.249:32400"><label>Token</label><input name="hooks['+idx+'][token]" placeholder="Plex token">';
          }
        }
        </script>`
    }`;
}
```

```typescript
// src/views/edit.ts
import type { PortMapping, Hook } from "../db.js";

export function editView(mapping: PortMapping, hooks: Hook[]): string {
  return `
    <h1>Edit: ${mapping.label || "Unnamed"}</h1>
    <p class="muted mb">VPN Port: <span class="port-num">${mapping.vpnPort}</span></p>

    <form method="POST" action="/edit/${mapping.id}" class="card">
      <label for="label">Label</label>
      <input type="text" id="label" name="label" value="${mapping.label}">

      <label for="destIp">Destination IP</label>
      <input type="text" id="destIp" name="destIp" value="${mapping.destIp}" required>

      <label for="destPort">Destination Port</label>
      <input type="number" id="destPort" name="destPort" value="${mapping.destPort}" required>

      <label for="protocol">Protocol</label>
      <select id="protocol" name="protocol">
        <option value="both" ${mapping.protocol === "both" ? "selected" : ""}>TCP + UDP</option>
        <option value="tcp" ${mapping.protocol === "tcp" ? "selected" : ""}>TCP only</option>
        <option value="udp" ${mapping.protocol === "udp" ? "selected" : ""}>UDP only</option>
      </select>

      <div><button type="submit" class="btn btn-primary">Save Changes</button></div>
    </form>

    <h2>Hooks</h2>
    ${hooks.length === 0
      ? '<p class="muted">No hooks configured.</p>'
      : hooks.map((h) => {
          const config = JSON.parse(h.config);
          return `<div class="card">
            <strong>${h.type}</strong>: ${h.type === "plugin" ? config.plugin : h.type === "webhook" ? config.url : config.command}
            <div class="muted">Last: ${h.lastStatus ?? "never"} ${h.lastError ? `- ${h.lastError}` : ""}</div>
          </div>`;
        }).join("")
    }`;
}
```

```typescript
// src/views/logs.ts
import type { SyncLogEntry } from "../db.js";

export function logsView(logs: SyncLogEntry[]): string {
  const rows = logs.map((l) => `
    <tr>
      <td class="muted">${new Date(l.timestamp * 1000).toLocaleString()}</td>
      <td>${l.action}</td>
      <td class="muted">${l.mappingId ?? "-"}</td>
      <td><code>${l.details}</code></td>
    </tr>`).join("");

  return `
    <h1>Sync Log</h1>
    ${logs.length === 0
      ? '<div class="card"><p>No log entries yet.</p></div>'
      : `<table>
          <thead><tr><th>Time</th><th>Action</th><th>Mapping</th><th>Details</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
    }`;
}
```

- [ ] **Step 4: Create UI routes**

```typescript
// src/routes/ui.ts
import { Hono } from "hono";
import type { Db } from "../db.js";
import type { VpnProvider } from "../providers/types.js";
import type { UnifiClient } from "../unifi/types.js";
import { layout } from "../views/layout.js";
import { dashboardView } from "../views/dashboard.js";
import { createView } from "../views/create.js";
import { editView } from "../views/edit.js";
import { logsView } from "../views/logs.js";

interface UiRoutesConfig {
  db: Db;
  provider: VpnProvider;
  unifi: UnifiClient;
  vpnInterface: string;
}

export function createUiRoutes(config: UiRoutesConfig): Hono {
  const { db, provider, unifi, vpnInterface } = config;
  const ui = new Hono();

  ui.get("/", async (c) => {
    const mappings = db.listMappings().map((m) => ({
      ...m,
      hooks: db.listHooks(m.id),
    }));

    let providerConnected = false;
    let providerPorts = 0;
    try {
      const ports = await provider.listPorts();
      providerConnected = true;
      providerPorts = ports.length;
    } catch {}

    let unifiConnected = false;
    try {
      await unifi.login();
      unifiConnected = true;
    } catch {}

    const html = dashboardView(mappings, {
      provider: { connected: providerConnected, name: provider.name, activePorts: providerPorts, maxPorts: provider.maxPorts },
      unifi: { connected: unifiConnected },
    });
    return c.html(layout("Dashboard", html));
  });

  ui.get("/create", (c) => {
    const active = db.listMappings().filter((m) => m.status === "active").length;
    return c.html(layout("New Mapping", createView(provider.maxPorts, active)));
  });

  ui.post("/create", async (c) => {
    const form = await c.req.parseBody();
    const body = {
      destIp: form.destIp as string,
      destPort: Number(form.destPort),
      protocol: form.protocol as string,
      label: form.label as string,
    };

    // Reuse API logic -- call internal API endpoint
    const apiBase = `http://localhost:${c.req.header("host")?.split(":")[1] ?? "3000"}`;
    const res = await fetch(`${apiBase}/api/mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return c.redirect("/");
  });

  ui.get("/edit/:id", (c) => {
    const mapping = db.getMapping(c.req.param("id"));
    if (!mapping) return c.redirect("/");
    const hooks = db.listHooks(mapping.id);
    return c.html(layout(`Edit ${mapping.label}`, editView(mapping, hooks)));
  });

  ui.post("/edit/:id", async (c) => {
    const id = c.req.param("id");
    const form = await c.req.parseBody();
    const body = {
      destIp: form.destIp as string,
      destPort: Number(form.destPort),
      protocol: form.protocol as string,
      label: form.label as string,
    };

    const apiBase = `http://localhost:${c.req.header("host")?.split(":")[1] ?? "3000"}`;
    await fetch(`${apiBase}/api/mappings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return c.redirect("/");
  });

  ui.post("/delete/:id", async (c) => {
    const id = c.req.param("id");
    const apiBase = `http://localhost:${c.req.header("host")?.split(":")[1] ?? "3000"}`;
    await fetch(`${apiBase}/api/mappings/${id}`, { method: "DELETE" });
    return c.redirect("/");
  });

  ui.get("/logs", (c) => {
    const logs = db.getRecentLogs(100);
    return c.html(layout("Logs", logsView(logs)));
  });

  return ui;
}
```

- [ ] **Step 5: Run build to check for type errors**

```bash
pnpm build
```

Expected: Clean compilation.

- [ ] **Step 6: Commit**

```bash
git add src/views/ src/routes/ui.ts
git commit -m "feat: server-rendered web UI with dashboard, create, edit, and logs views"
```

---

### Task 9: Entry Point + Wiring

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Wire everything together in index.ts**

```typescript
// src/index.ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { createProvider } from "./providers/index.js";
import { createUnifiClient } from "./unifi/client.js";
import { createSyncWatchdog } from "./sync.js";
import { createApiRoutes } from "./routes/api.js";
import { createUiRoutes } from "./routes/ui.js";

const config = loadConfig();
const db = createDb(process.env.DB_PATH ?? "/data/vpnportmanager.db");
const provider = createProvider(config);
const unifi = createUnifiClient({
  host: config.unifiHost,
  username: config.unifiUsername,
  password: config.unifiPassword,
  vpnInterface: config.unifiVpnInterface,
});

const app = new Hono();
app.route("/api", createApiRoutes({ db, provider, unifi, vpnInterface: config.unifiVpnInterface }));
app.route("/", createUiRoutes({ db, provider, unifi, vpnInterface: config.unifiVpnInterface }));

const watchdog = createSyncWatchdog({
  db,
  provider,
  unifi,
  renewThresholdDays: config.renewThresholdDays,
});

// Run initial sync
watchdog.runOnce().catch((err) => {
  console.error("Initial sync failed:", err.message);
});

// Start periodic sync
watchdog.start(config.syncIntervalMs);

console.log(`VPN Port Manager starting on port ${config.port}`);
console.log(`Provider: ${provider.name} (max ${provider.maxPorts} ports)`);
console.log(`UniFi: ${config.unifiHost}`);
console.log(`Sync interval: ${config.syncIntervalMs / 1000}s`);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Shutting down...");
  watchdog.stop();
  db.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Shutting down...");
  watchdog.stop();
  db.close();
  process.exit(0);
});
```

- [ ] **Step 2: Verify it compiles**

```bash
pnpm build
```

Expected: Clean compilation.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire entry point with server, sync watchdog, and graceful shutdown"
```

---

### Task 10: Docker Setup

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
# Dockerfile
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build

FROM node:22-slim AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

RUN mkdir -p /data

ENV NODE_ENV=production
ENV NODE_TLS_REJECT_UNAUTHORIZED=0

EXPOSE 3000
VOLUME ["/data"]

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Create docker-compose.yml**

```yaml
# docker-compose.yml
services:
  vpn-port-manager:
    build: .
    container_name: vpn-port-manager
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - vpn-pm-data:/data
    environment:
      - VPN_PROVIDER=azire
      - VPN_API_TOKEN=${VPN_API_TOKEN}
      - VPN_INTERNAL_IP=${VPN_INTERNAL_IP}
      - MAX_PORTS=5
      - UNIFI_HOST=${UNIFI_HOST}
      - UNIFI_USERNAME=${UNIFI_USERNAME}
      - UNIFI_PASSWORD=${UNIFI_PASSWORD}
      - UNIFI_VPN_INTERFACE=${UNIFI_VPN_INTERFACE}
      - SYNC_INTERVAL_MS=300000
      - RENEW_THRESHOLD_DAYS=30
      - PORT=3000

volumes:
  vpn-pm-data:
```

- [ ] **Step 3: Create .dockerignore**

```
node_modules
dist
.env
*.md
tests
.git
```

- [ ] **Step 4: Build Docker image**

```bash
docker build -t vpn-port-manager .
```

Expected: Successful build.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "feat: Docker setup with multi-stage build and compose"
```

---

### Task 11: Run All Tests + Final Verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: All tests PASS across all test files.

- [ ] **Step 2: Run type checking**

```bash
pnpm build
```

Expected: Clean compilation, no type errors.

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
.env
*.db
```

- [ ] **Step 4: Final commit**

```bash
git add .gitignore
git commit -m "chore: add gitignore"
```
