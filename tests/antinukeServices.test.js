const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createAntinukeConfigService } = require('../src/services/antinukeConfigService');
const { createIncidentService } = require('../src/services/incidentService');
const { createChannelLockService } = require('../src/services/channelLockService');

const G = '111111111111111111';
const U = '222222222222222222';
const C = '333333333333333333';

function fresh(now) {
    const db = openDatabase(':memory:');
    runMigrations(db, MIGRATIONS_DIR);
    return { db, config: createAntinukeConfigService(db, { now }), incidents: createIncidentService(db, { now }), locks: createChannelLockService(db) };
}

test('anti-nuke is OFF by default and can be toggled', () => {
    const { config } = fresh();
    assert.strictEqual(config.getEffective(G).enabled, false);
    config.setEnabled(G, true);
    assert.strictEqual(config.getEffective(G).enabled, true);
    config.setEnabled(G, false);
    assert.strictEqual(config.getEffective(G).enabled, false);
});

test('mode, sensitivity, validation', () => {
    const { config } = fresh();
    config.setMode(G, 'contain');
    config.setSensitivity(G, 'strict');
    const cfg = config.getEffective(G);
    assert.strictEqual(cfg.mode, 'contain');
    assert.strictEqual(cfg.sensitivity, 'strict');
    assert.throws(() => config.setMode(G, 'ban-everyone'), TypeError);
    assert.throws(() => config.setThreshold(G, 'nope', 3, 10), TypeError);
    assert.throws(() => config.setThreshold(G, 'channelDelete', 0, 10), TypeError);
    assert.throws(() => config.setSafeMode(G, 5000), TypeError);
});

test('safe mode forces contain and expires', () => {
    let clock = Date.parse('2026-01-01T00:00:00Z');
    const { config } = fresh(() => clock);
    config.setSafeMode(G, 10);
    let cfg = config.getEffective(G);
    assert.ok(cfg.safe);
    assert.strictEqual(cfg.mode, 'contain');
    assert.strictEqual(cfg.configuredMode, 'alert');
    clock += 11 * 60000;
    cfg = config.getEffective(G);
    assert.strictEqual(cfg.safe, false);
    assert.strictEqual(cfg.mode, 'alert');
});

test('thresholds and trusted lists', () => {
    const { config } = fresh();
    config.setThreshold(G, 'channelDelete', 6, 30);
    assert.deepStrictEqual(config.getEffective(G).overrides.channelDelete, { threshold: 6, windowSec: 30 });
    assert.strictEqual(config.clearThreshold(G, 'channelDelete'), true);
    assert.strictEqual(config.addTrusted(G, 'user', U), true);
    assert.strictEqual(config.addTrusted(G, 'user', U), false);
    assert.deepStrictEqual(config.listTrusted(G).userIds, [U]);
    assert.strictEqual(config.removeTrusted(G, 'user', U), true);
});

test('incidents: numbering per server, save, recent-open lookup', () => {
    const { incidents } = fresh();
    const mk = () => incidents.createIncident({ guildId: G, actorId: U, actorClass: 'member', severity: 'medium', rules: [{ rule: 'channelDelete', count: 3, threshold: 3, windowSec: 10 }], evidence: [] });
    const a = mk(); const b = mk();
    assert.strictEqual(a.number, 1);
    assert.strictEqual(b.number, 2);
    assert.strictEqual(incidents.findRecentOpen(G, U, 120000).number, 2);
    incidents.saveIncident({ ...b, status: 'safe' });
    assert.strictEqual(incidents.findRecentOpen(G, U, 120000).number, 1);
    assert.strictEqual(incidents.getIncident(G, 2).status, 'safe');
});

test('deleted items can be claimed only once', () => {
    const { incidents } = fresh();
    incidents.saveDeletedItem({ guildId: G, kind: 'channel', originalId: C, actorId: U, data: { name: 'x' } });
    const items = incidents.listDeletedItems(G, U, Date.now() - 60000);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(incidents.claimDeletedItem(items[0].id), true);
    assert.strictEqual(incidents.claimDeletedItem(items[0].id), false);
    assert.strictEqual(incidents.listDeletedItems(G, U, Date.now() - 60000).length, 0);
});

test('lock source: lockdown locks are listed separately from /lock', () => {
    const { locks } = fresh();
    locks.saveLock({ guildId: G, channelId: C, previousState: 'neutral', lockedBy: U });
    locks.saveLock({ guildId: G, channelId: '444444444444444444', previousState: 'allow', lockedBy: U, source: 'lockdown' });
    assert.strictEqual(locks.listBySource(G, 'lockdown').length, 1);
    assert.strictEqual(locks.getLock(G, C).source, 'lock');
});
