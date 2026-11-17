const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createGiveawayService, GiveawayServiceError } = require('../src/services/giveawayService');
const { pickWinners, entryProblem, parseWhen } = require('../src/giveaways/giveawayRules');

const G = '111111111111111111', C = '444444444444444441', H = '222222222222222220', R1 = '333333333333333331', R2 = '333333333333333332';
const fresh = (now) => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return createGiveawayService(db, { now }); };
const base = { channelId: C, hostId: H, prize: 'Nitro', winners: 1, endsAt: 5000 };

test('winners: unique, never more than asked or available, fair with the rng', () => {
    assert.deepStrictEqual(pickWinners(['a', 'b', 'c'], 2, () => 0), ['a', 'b']);
    assert.deepStrictEqual(pickWinners(['a', 'b', 'c'], 2, () => 0.99), ['c', 'b']);
    assert.deepStrictEqual(pickWinners(['a'], 5), ['a']);
    assert.deepStrictEqual(pickWinners([], 3), []);
    assert.strictEqual(new Set(pickWinners(['a', 'a', 'b', 'b'], 4)).size, 2); // duplicates collapse
    const counts = { a: 0, b: 0, c: 0, d: 0 };
    for (let i = 0; i < 4000; i++) counts[pickWinners(['a', 'b', 'c', 'd'], 1)[0]]++;
    for (const n of Object.values(counts)) assert.ok(n > 800 && n < 1200, `fair spread ${JSON.stringify(counts)}`);
});
test('entry requirements: role, level, days, bypass', () => {
    const g = { requiredRoleId: R1, bypassRoleId: R2, minLevel: 5, minDays: 7 };
    const day = 864e5; const now = 100 * day;
    const p = (o) => ({ roleIds: [], level: 0, joinedAt: now - 30 * day, ...o });
    assert.match(entryProblem(g, p({}), now), /role/);
    assert.match(entryProblem(g, p({ roleIds: [R1], level: 2 }), now), /level/);
    assert.match(entryProblem(g, p({ roleIds: [R1], level: 9, joinedAt: now - 2 * day }), now), /day/);
    assert.strictEqual(entryProblem(g, p({ roleIds: [R1], level: 9 }), now), null);
    assert.strictEqual(entryProblem(g, p({ roleIds: [R2] }), now), null); // bypass
    assert.strictEqual(entryProblem({ requiredRoleId: null, bypassRoleId: null, minLevel: 0, minDays: 0 }, p({ joinedAt: null }), now), null);
    assert.match(entryProblem({ minDays: 1, minLevel: 0 }, p({ joinedAt: null }), now), /day/); // unknown join date does not pass
});
test('time parsing: durations, dates, time zones, bad dates', () => {
    assert.strictEqual(parseWhen('2h', { now: 1000 }), 1000 + 7200000);
    assert.strictEqual(parseWhen('2026-12-24 18:00', {}), Date.UTC(2026, 11, 24, 18));
    assert.strictEqual(parseWhen('2026-12-24 18:00', { offsetHours: 8 }), Date.UTC(2026, 11, 24, 10)); // 18:00 in UTC+8
    assert.strictEqual(parseWhen('2026-02-31 10:00', {}), null);
    assert.strictEqual(parseWhen('2026-13-01 10:00', {}), null);
    assert.strictEqual(parseWhen('2026-12-24 25:00', {}), null);
    assert.strictEqual(parseWhen('soon', {}), null); assert.strictEqual(parseWhen('', {}), null); assert.strictEqual(parseWhen(null, {}), null);
});
test('giveaway service: create, validate, limits, isolation', () => {
    const s = fresh(() => 1000).giveaways;
    const g = s.create(G, base); assert.strictEqual(g.status, 'active'); assert.strictEqual(g.minLevel, 0);
    assert.throws(() => s.create(G, { ...base, prize: '  ' }), GiveawayServiceError);
    assert.throws(() => s.create(G, { ...base, prize: 'x'.repeat(201) }), GiveawayServiceError);
    assert.throws(() => s.create(G, { ...base, winners: 21 }), GiveawayServiceError);
    assert.throws(() => s.create(G, { ...base, requiredRoleId: 'bad' }), TypeError);
    assert.throws(() => s.create('bad', base), TypeError);
    assert.strictEqual(s.getForGuild('999999999999999999', g.id), null);
    for (let i = 0; i < 24; i++) s.create(G, base);
    assert.throws(() => s.create(G, base), GiveawayServiceError);
    assert.doesNotThrow(() => s.create('999999999999999999', base));
});
test('giveaway service: entries toggle, ending happens exactly once, due list', () => {
    let t = 1000; const s = fresh(() => t).giveaways; const g = s.create(G, base);
    assert.ok(s.addEntry(g.id, H)); assert.ok(!s.addEntry(g.id, H)); assert.ok(s.hasEntry(g.id, H)); assert.strictEqual(s.countEntries(g.id), 1);
    assert.ok(s.removeEntry(g.id, H)); assert.ok(!s.removeEntry(g.id, H));
    assert.deepStrictEqual(s.due(4000), []); assert.strictEqual(s.due(5000).length, 1);
    assert.ok(s.markEnded(g.id)); assert.ok(!s.markEnded(g.id)); assert.ok(!s.markCancelled(g.id));
    s.setWinners(g.id, [H]); assert.deepStrictEqual(s.get(g.id).winnerIds, [H]);
    assert.strictEqual(s.due(9999).length, 0); assert.strictEqual(s.listActive(G).length, 0); assert.strictEqual(s.listRecent(G).length, 1);
});
test('event service: rsvp changes answer, counts, reminder and start windows fire once', () => {
    let t = 1000; const s = fresh(() => t).events; const e = s.create(G, { channelId: C, hostId: H, title: 'Movie night', startsAt: 1000 + 3600e3 });
    s.rsvp(e.id, H, 'going'); s.rsvp(e.id, R1, 'maybe'); s.rsvp(e.id, R1, 'going');
    assert.deepStrictEqual(s.counts(e.id), { going: 2, maybe: 0 }); assert.ok(s.removeRsvp(e.id, H)); assert.deepStrictEqual(s.counts(e.id), { going: 1, maybe: 0 });
    assert.throws(() => s.rsvp(e.id, H, 'yes'), TypeError);
    const lead = 15 * 60e3;
    assert.strictEqual(s.dueReminders(lead, 1000).length, 0); assert.strictEqual(s.dueReminders(lead, e.startsAt - lead).length, 1);
    assert.ok(s.markReminded(e.id)); assert.ok(!s.markReminded(e.id)); assert.strictEqual(s.dueReminders(lead, e.startsAt).length, 0);
    assert.strictEqual(s.dueStarts(e.startsAt - 1).length, 0); assert.strictEqual(s.dueStarts(e.startsAt).length, 1);
    assert.ok(s.markStarted(e.id)); assert.ok(!s.markStarted(e.id)); assert.ok(!s.markCancelled(e.id));
    assert.throws(() => s.create(G, { channelId: C, hostId: H, title: 'Past', startsAt: 500 }), GiveawayServiceError);
    assert.throws(() => s.create(G, { channelId: C, hostId: H, title: '', startsAt: 9e9 }), GiveawayServiceError);
});
