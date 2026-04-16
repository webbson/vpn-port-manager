import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../src/db.js';
import type { Db } from '../src/db.js';

describe('Database layer', () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(':memory:');
  });

  const sampleMapping = {
    provider: 'mullvad',
    vpnPort: 51820,
    destIp: '192.168.1.100',
    destPort: 8080,
    protocol: 'tcp',
    label: 'test-mapping',
    status: 'pending',
    expiresAt: Math.floor(Date.now() / 1000) + 86400,
  };

  it('inserts and retrieves a mapping', () => {
    const id = db.createMapping(sampleMapping);
    expect(id).toBeTruthy();

    const mapping = db.getMapping(id);
    expect(mapping).not.toBeNull();
    expect(mapping!.id).toBe(id);
    expect(mapping!.provider).toBe('mullvad');
    expect(mapping!.vpnPort).toBe(51820);
    expect(mapping!.destIp).toBe('192.168.1.100');
    expect(mapping!.destPort).toBe(8080);
    expect(mapping!.protocol).toBe('tcp');
    expect(mapping!.label).toBe('test-mapping');
    expect(mapping!.status).toBe('pending');
    expect(mapping!.unifiDnatId).toBeNull();
    expect(mapping!.unifiFirewallId).toBeNull();
    expect(mapping!.createdAt).toBeGreaterThan(0);
    expect(mapping!.updatedAt).toBeGreaterThan(0);
  });

  it('returns null for a non-existent mapping', () => {
    expect(db.getMapping('non-existent-id')).toBeNull();
  });

  it('lists all mappings ordered by created_at DESC', () => {
    const id1 = db.createMapping({ ...sampleMapping, label: 'first' });
    const id2 = db.createMapping({ ...sampleMapping, label: 'second' });
    const id3 = db.createMapping({ ...sampleMapping, label: 'third' });

    const mappings = db.listMappings();
    expect(mappings).toHaveLength(3);
    // newest first — id3 was inserted last
    expect(mappings[0].id).toBe(id3);
    expect(mappings[1].id).toBe(id2);
    expect(mappings[2].id).toBe(id1);
  });

  it('updates a mapping with only the provided fields', () => {
    const id = db.createMapping(sampleMapping);
    const before = db.getMapping(id)!;

    db.updateMapping(id, { status: 'active', unifiDnatId: 'dnat-123' });

    const after = db.getMapping(id)!;
    expect(after.status).toBe('active');
    expect(after.unifiDnatId).toBe('dnat-123');
    // unchanged fields stay the same
    expect(after.vpnPort).toBe(before.vpnPort);
    expect(after.destIp).toBe(before.destIp);
    expect(after.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it('deletes a mapping', () => {
    const id = db.createMapping(sampleMapping);
    expect(db.getMapping(id)).not.toBeNull();

    db.deleteMapping(id);
    expect(db.getMapping(id)).toBeNull();
  });

  it('creates and lists hooks for a mapping', () => {
    const mappingId = db.createMapping(sampleMapping);
    const hookId = db.createHook({
      mappingId,
      type: 'webhook',
      config: JSON.stringify({ url: 'https://example.com/hook' }),
    });

    expect(hookId).toBeTruthy();

    const hooks = db.listHooks(mappingId);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].id).toBe(hookId);
    expect(hooks[0].mappingId).toBe(mappingId);
    expect(hooks[0].type).toBe('webhook');
    expect(hooks[0].lastRunAt).toBeNull();
    expect(hooks[0].lastStatus).toBeNull();
    expect(hooks[0].lastError).toBeNull();
  });

  it('cascade-deletes hooks when mapping is deleted', () => {
    const mappingId = db.createMapping(sampleMapping);
    db.createHook({ mappingId, type: 'webhook', config: '{}' });
    db.createHook({ mappingId, type: 'script', config: '{}' });

    expect(db.listHooks(mappingId)).toHaveLength(2);

    db.deleteMapping(mappingId);
    expect(db.listHooks(mappingId)).toHaveLength(0);
  });

  it('updates hook status', () => {
    const mappingId = db.createMapping(sampleMapping);
    const hookId = db.createHook({ mappingId, type: 'webhook', config: '{}' });

    db.updateHookStatus(hookId, 'success');
    const hooks = db.listHooks(mappingId);
    expect(hooks[0].lastStatus).toBe('success');
    expect(hooks[0].lastError).toBeNull();
    expect(hooks[0].lastRunAt).toBeGreaterThan(0);
  });

  it('logs and retrieves sync entries newest first', () => {
    const mappingId = db.createMapping(sampleMapping);

    db.logSync('create', mappingId, { foo: 'bar' });
    db.logSync('update', mappingId, { baz: 1 });
    db.logSync('sync', null, {});

    const logs = db.getRecentLogs(10);
    expect(logs).toHaveLength(3);
    // newest first (highest id last inserted = logs[0])
    expect(logs[0].action).toBe('sync');
    expect(logs[1].action).toBe('update');
    expect(logs[2].action).toBe('create');
    expect(logs[0].mappingId).toBeNull();
    expect(logs[1].mappingId).toBe(mappingId);
  });

  it('respects the limit in getRecentLogs', () => {
    const mappingId = db.createMapping(sampleMapping);
    db.logSync('a', mappingId, {});
    db.logSync('b', mappingId, {});
    db.logSync('c', mappingId, {});

    expect(db.getRecentLogs(2)).toHaveLength(2);
  });
});
