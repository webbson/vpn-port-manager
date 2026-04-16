import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

// ---- Types ----

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

// ---- Row mappers ----

interface MappingRow {
  id: string;
  provider: string;
  vpn_port: number;
  dest_ip: string;
  dest_port: number;
  protocol: string;
  label: string;
  status: string;
  expires_at: number;
  unifi_dnat_id: string | null;
  unifi_firewall_id: string | null;
  created_at: number;
  updated_at: number;
}

interface HookRow {
  id: string;
  mapping_id: string;
  type: string;
  config: string;
  last_run_at: number | null;
  last_status: string | null;
  last_error: string | null;
}

interface SyncLogRow {
  id: number;
  timestamp: number;
  action: string;
  mapping_id: string | null;
  details: string;
}

function rowToMapping(row: MappingRow): PortMapping {
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

function rowToHook(row: HookRow): Hook {
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

function rowToSyncLogEntry(row: SyncLogRow): SyncLogEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    action: row.action,
    mappingId: row.mapping_id,
    details: row.details,
  };
}

// ---- Migrations ----

const MIGRATIONS = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS port_mappings (
  id              TEXT    PRIMARY KEY,
  provider        TEXT    NOT NULL,
  vpn_port        INTEGER NOT NULL,
  dest_ip         TEXT    NOT NULL,
  dest_port       INTEGER NOT NULL,
  protocol        TEXT    NOT NULL DEFAULT 'both',
  label           TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'pending',
  expires_at      INTEGER NOT NULL,
  unifi_dnat_id   TEXT,
  unifi_firewall_id TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hooks (
  id            TEXT    PRIMARY KEY,
  mapping_id    TEXT    NOT NULL REFERENCES port_mappings(id) ON DELETE CASCADE,
  type          TEXT    NOT NULL,
  config        TEXT    NOT NULL,
  last_run_at   INTEGER,
  last_status   TEXT,
  last_error    TEXT
);

CREATE TABLE IF NOT EXISTS sync_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   INTEGER NOT NULL,
  action      TEXT    NOT NULL,
  mapping_id  TEXT,
  details     TEXT    NOT NULL DEFAULT '{}'
);
`;

// ---- Factory ----

export function createDb(path: string): Db {
  const sqlite = new Database(path);

  // Run pragmas and DDL
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS port_mappings (
      id              TEXT    PRIMARY KEY,
      provider        TEXT    NOT NULL,
      vpn_port        INTEGER NOT NULL,
      dest_ip         TEXT    NOT NULL,
      dest_port       INTEGER NOT NULL,
      protocol        TEXT    NOT NULL DEFAULT 'both',
      label           TEXT    NOT NULL DEFAULT '',
      status          TEXT    NOT NULL DEFAULT 'pending',
      expires_at      INTEGER NOT NULL,
      unifi_dnat_id   TEXT,
      unifi_firewall_id TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hooks (
      id            TEXT    PRIMARY KEY,
      mapping_id    TEXT    NOT NULL REFERENCES port_mappings(id) ON DELETE CASCADE,
      type          TEXT    NOT NULL,
      config        TEXT    NOT NULL,
      last_run_at   INTEGER,
      last_status   TEXT,
      last_error    TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      action      TEXT    NOT NULL,
      mapping_id  TEXT,
      details     TEXT    NOT NULL DEFAULT '{}'
    );
  `);

  // Prepared statements
  const stmtInsertMapping = sqlite.prepare<{
    id: string; provider: string; vpn_port: number; dest_ip: string;
    dest_port: number; protocol: string; label: string; status: string;
    expires_at: number; created_at: number; updated_at: number;
  }>(`
    INSERT INTO port_mappings
      (id, provider, vpn_port, dest_ip, dest_port, protocol, label, status,
       expires_at, unifi_dnat_id, unifi_firewall_id, created_at, updated_at)
    VALUES
      (@id, @provider, @vpn_port, @dest_ip, @dest_port, @protocol, @label,
       @status, @expires_at, NULL, NULL, @created_at, @updated_at)
  `);

  const stmtGetMapping = sqlite.prepare<[string]>(
    'SELECT * FROM port_mappings WHERE id = ?'
  );

  const stmtListMappings = sqlite.prepare(
    'SELECT * FROM port_mappings ORDER BY created_at DESC, rowid DESC'
  );

  const stmtDeleteMapping = sqlite.prepare<[string]>(
    'DELETE FROM port_mappings WHERE id = ?'
  );

  const stmtInsertHook = sqlite.prepare<{
    id: string; mapping_id: string; type: string; config: string;
  }>(`
    INSERT INTO hooks (id, mapping_id, type, config)
    VALUES (@id, @mapping_id, @type, @config)
  `);

  const stmtListHooks = sqlite.prepare<[string]>(
    'SELECT * FROM hooks WHERE mapping_id = ?'
  );

  const stmtDeleteHook = sqlite.prepare<[string]>(
    'DELETE FROM hooks WHERE id = ?'
  );

  const stmtUpdateHookStatus = sqlite.prepare<[string, number, string | null, string]>(`
    UPDATE hooks
    SET last_status = ?, last_run_at = ?, last_error = ?
    WHERE id = ?
  `);

  const stmtInsertLog = sqlite.prepare<{
    timestamp: number; action: string; mapping_id: string | null; details: string;
  }>(`
    INSERT INTO sync_log (timestamp, action, mapping_id, details)
    VALUES (@timestamp, @action, @mapping_id, @details)
  `);

  const stmtGetRecentLogs = sqlite.prepare<[number]>(
    'SELECT * FROM sync_log ORDER BY id DESC LIMIT ?'
  );

  return {
    close() {
      sqlite.close();
    },

    createMapping(input: CreateMappingInput): string {
      const id = uuidv4();
      const now = Date.now();
      stmtInsertMapping.run({
        id,
        provider: input.provider,
        vpn_port: input.vpnPort,
        dest_ip: input.destIp,
        dest_port: input.destPort,
        protocol: input.protocol,
        label: input.label,
        status: input.status,
        expires_at: input.expiresAt,
        created_at: now,
        updated_at: now,
      });
      return id;
    },

    getMapping(id: string): PortMapping | null {
      const row = stmtGetMapping.get(id) as MappingRow | undefined;
      return row ? rowToMapping(row) : null;
    },

    listMappings(): PortMapping[] {
      const rows = stmtListMappings.all() as MappingRow[];
      return rows.map(rowToMapping);
    },

    updateMapping(id: string, input: UpdateMappingInput): void {
      const now = Date.now();

      // Build dynamic SET clause from provided fields only
      const fieldMap: Record<keyof UpdateMappingInput, string> = {
        vpnPort: 'vpn_port',
        destIp: 'dest_ip',
        destPort: 'dest_port',
        protocol: 'protocol',
        label: 'label',
        status: 'status',
        expiresAt: 'expires_at',
        unifiDnatId: 'unifi_dnat_id',
        unifiFirewallId: 'unifi_firewall_id',
      };

      const setClauses: string[] = ['updated_at = @updated_at'];
      const params: Record<string, unknown> = { id, updated_at: now };

      for (const [key, col] of Object.entries(fieldMap) as [keyof UpdateMappingInput, string][]) {
        if (Object.prototype.hasOwnProperty.call(input, key)) {
          setClauses.push(`${col} = @${col}`);
          params[col] = input[key] as unknown;
        }
      }

      const sql = `UPDATE port_mappings SET ${setClauses.join(', ')} WHERE id = @id`;
      sqlite.prepare(sql).run(params);
    },

    deleteMapping(id: string): void {
      stmtDeleteMapping.run(id);
    },

    createHook(input: CreateHookInput): string {
      const id = uuidv4();
      stmtInsertHook.run({
        id,
        mapping_id: input.mappingId,
        type: input.type,
        config: input.config,
      });
      return id;
    },

    listHooks(mappingId: string): Hook[] {
      const rows = stmtListHooks.all(mappingId) as HookRow[];
      return rows.map(rowToHook);
    },

    deleteHook(id: string): void {
      stmtDeleteHook.run(id);
    },

    updateHookStatus(id: string, status: string, error?: string): void {
      const now = Date.now();
      stmtUpdateHookStatus.run(status, now, error ?? null, id);
    },

    logSync(action: string, mappingId: string | null, details: object): void {
      const now = Date.now();
      stmtInsertLog.run({
        timestamp: now,
        action,
        mapping_id: mappingId,
        details: JSON.stringify(details),
      });
    },

    getRecentLogs(limit: number): SyncLogEntry[] {
      const rows = stmtGetRecentLogs.all(limit) as SyncLogRow[];
      return rows.map(rowToSyncLogEntry);
    },
  };
}

// suppress unused variable warning for the MIGRATIONS constant
void MIGRATIONS;
