const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createLevelService, LevelServiceError } = require('../src/services/levelService');
const { createAntinukeConfigService } = require('../src/services/antinukeConfigService');
const math = require('../src/leveling/xpMath');
const { renderLevelMessage, planLevelRoles } = require('../src/leveling/levelTemplate');

const G = '111111111111111111', U = '222222222222222222', U2 = '222222222222222223';
const R1 = '333333333333333331', R2 = '333333333333333332', C1 = '444444444444444441';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };

test('level maths: thresholds and round trip', () => {
    assert.strictEqual(math.xpToNext(0), 100); assert.strictEqual(math.xpToNext(1), 155);
    assert.strictEqual(math.levelFromXp(0), 0); assert.strictEqual(math.levelFromXp(99), 0); assert.strictEqual(math.levelFromXp(100), 1);
    assert.strictEqual(math.levelFromXp(254), 1); assert.strictEqual(math.levelFromXp(255), 2);
    for (let l = 0; l <= 60; l++) { assert.strictEqual(math.levelFromXp(math.totalXpForLevel(l)), l); if (l) assert.strictEqual(math.levelFromXp(math.totalXpForLevel(l) - 1), l - 1); }
    assert.strictEqual(math.levelFromXp(-50), 0); assert.strictEqual(math.levelFromXp(1e15), math.MAX_LEVEL);
    assert.deepStrictEqual(math.progress(130), { level: 1, current: 30, needed: 155, percent: 19 });
});
test('xp roll and multipliers: only the best boost counts', () => {
    assert.strictEqual(math.rollXp(15, 25, () => 0), 15); assert.strictEqual(math.rollXp(15, 25, () => 0.9999), 25); assert.strictEqual(math.rollXp(25, 15, () => 0), 15);
    assert.strictEqual(math.applyMultipliers(20, 100, []), 20);
    assert.strictEqual(math.applyMultipliers(20, 200, [150, 300]), 120); // 20 * 2 * 3
    assert.strictEqual(math.applyMultipliers(1, 10, []), 1); // never below 1
});
test('periods: week runs Monday to Sunday, month by calendar, previous period', () => {
    const wed = Date.UTC(2026, 10, 11, 12); // Wed 11 Nov 2026
    const w = math.periodRange('weekly', wed); assert.strictEqual(new Date(w.startDay * 864e5).getUTCDay(), 1); assert.strictEqual(w.endDay - w.startDay, 6); assert.ok(math.dayNumber(wed) >= w.startDay && math.dayNumber(wed) <= w.endDay);
    const prev = math.periodRange('weekly', wed, -1); assert.strictEqual(prev.endDay + 1, w.startDay);
    const m = math.periodRange('monthly', wed); assert.strictEqual(new Date(m.startDay * 864e5).toISOString().slice(0, 10), '2026-11-01'); assert.strictEqual(new Date(m.endDay * 864e5).toISOString().slice(0, 10), '2026-11-30');
    const pm = math.periodRange('monthly', Date.UTC(2026, 0, 15), -1); assert.strictEqual(new Date(pm.startDay * 864e5).toISOString().slice(0, 10), '2025-12-01');
    const d = math.periodRange('daily', wed, -1); assert.strictEqual(d.startDay, math.dayNumber(wed) - 1);
    assert.notStrictEqual(math.periodKey('weekly', wed), math.periodKey('weekly', wed + 7 * 864e5)); assert.strictEqual(math.periodKey('weekly', wed), math.periodKey('weekly', wed + 864e5));
    assert.throws(() => math.periodRange('yearly', wed), TypeError);
});
test('level-up message placeholders', () => {
    const v = { userId: U, username: 'sam', displayname: 'Sam', level: 5, oldLevel: 4, xp: 12345, rank: 3, server: 'Cool', roleId: R1 };
    assert.strictEqual(renderLevelMessage('{user} hit **{level}** (was {oldlevel}) {xp} {rank} {SERVER} {role} {nope}', v), `<@${U}> hit **5** (was 4) 12,345 #3 Cool <@&${R1}> {nope}`);
    assert.strictEqual(renderLevelMessage('a\\nb', v), 'a\nb');
    assert.strictEqual(renderLevelMessage('{rank}{role}', { ...v, rank: null, roleId: null }), 'unranked');
    assert.strictEqual(renderLevelMessage(null, v), '');
});
test('level roles: stack keeps all earned, replace keeps only the highest', () => {
    const rewards = [{ level: 5, roleId: R1 }, { level: 10, roleId: R2 }];
    assert.deepStrictEqual(planLevelRoles(rewards, 4, 'stack'), { keep: [], drop: [R1, R2] });
    assert.deepStrictEqual(planLevelRoles(rewards, 12, 'stack'), { keep: [R1, R2], drop: [] });
    assert.deepStrictEqual(planLevelRoles(rewards, 12, 'replace'), { keep: [R2], drop: [R1] });
});

test('level service: off by default, cooldown, min length, ignores', () => {
    let t = 1_000_000; const s = createLevelService(fresh(), { now: () => t, rng: () => 0 });
    const msg = (extra = {}) => s.awardMessage({ guildId: G, userId: U, channelId: C1, roleIds: [], contentLength: 10, ...extra });
    assert.strictEqual(msg(), null); // off
    s.setConfig(G, { enabled: true });
    const first = msg(); assert.strictEqual(first.gained, 15); assert.strictEqual(first.xp, 15);
    assert.strictEqual(msg(), null); // cooldown
    t += 61_000; assert.ok(msg());
    t += 61_000; assert.strictEqual(msg({ contentLength: 2 }), null); // too short
    s.addIgnore(G, 'channel', C1); t += 61_000; assert.strictEqual(msg(), null);
    s.removeIgnore(G, 'channel', C1); s.addIgnore(G, 'role', R1); assert.strictEqual(msg({ roleIds: [R1] }), null);
    assert.ok(msg({ roleIds: [R2] }));
});
test('level service: level-up is reported once, daily rows added up, boosts', () => {
    let t = Date.UTC(2026, 10, 11, 12); const s = createLevelService(fresh(), { now: () => t, rng: () => 0 });
    s.setConfig(G, { enabled: true, xpMin: 100, xpMax: 100, cooldownSeconds: 0 });
    const a = s.awardMessage({ guildId: G, userId: U, channelId: C1, contentLength: 10 }); assert.ok(a.leveledUp); assert.strictEqual(a.level, 1);
    const b = s.awardMessage({ guildId: G, userId: U, channelId: C1, contentLength: 10 }); assert.ok(!b.leveledUp);
    s.setBoost(G, R1, 150); const c = s.awardMessage({ guildId: G, userId: U2, channelId: C1, roleIds: [R1], contentLength: 10 }); assert.strictEqual(c.gained, 150);
    t += 864e5; s.awardMessage({ guildId: G, userId: U, channelId: C1, contentLength: 10 });
    const range = math.periodRange('daily', t);
    assert.deepStrictEqual(s.topPeriod(G, range.startDay, range.endDay).map((r) => [r.userId, r.xp]), [[U, 100]]);
    const week = math.periodRange('weekly', t);
    const top = s.topPeriod(G, week.startDay, week.endDay); assert.strictEqual(top.length, 2); assert.ok(top[0].xp >= top[1].xp);
    assert.strictEqual(s.countPeriod(G, week.startDay, week.endDay), 2);
    assert.strictEqual(s.getRank(G, U), 1); assert.strictEqual(s.getRank(G, '999999999999999990'), null);
});
test('level service: removing XP never goes below zero and can lower the level', () => {
    const s = createLevelService(fresh()); s.addXp(G, U, 300); assert.strictEqual(s.getUser(G, U).level, 2);
    const r = s.addXp(G, U, -10000); assert.strictEqual(r.xp, 0); assert.strictEqual(r.level, 0); assert.ok(!r.leveledUp);
    s.setLevel(G, U, 5); assert.strictEqual(s.getUser(G, U).xp, math.totalXpForLevel(5)); assert.throws(() => s.setLevel(G, U, 501), LevelServiceError);
    assert.ok(s.resetUser(G, U)); assert.strictEqual(s.getUser(G, U).xp, 0);
});
test('level service: settings are validated and a failed change changes nothing', () => {
    const s = createLevelService(fresh());
    assert.throws(() => s.setConfig(G, { xpMin: 50, xpMax: 10 }), TypeError);
    assert.throws(() => s.setConfig(G, { xpMin: 0 }), TypeError);
    assert.throws(() => s.setConfig(G, { announceMode: 'everywhere' }), TypeError);
    assert.throws(() => s.setConfig(G, { levelupMessage: '' }), TypeError);
    assert.throws(() => s.setConfig(G, { levelupMessage: 'x'.repeat(1001) }), TypeError);
    assert.throws(() => s.setConfig(G, { hack: 1 }), TypeError);
    assert.throws(() => s.setConfig(G, { announceChannelId: 'abc' }), TypeError);
    assert.throws(() => s.setConfig(G, { enabled: true, xpMin: 9999 }), TypeError);
    assert.strictEqual(s.getConfig(G).enabled, false);
    s.setConfig(G, { levelupMessage: 'GG {user}', announceStyle: 'text' }); assert.strictEqual(s.getConfig(G).levelupMessage, 'GG {user}');
    s.resetConfig(G); assert.match(s.getConfig(G).levelupMessage, /just reached level/);
});
test('level service: level roles, limits, role deletion cleanup, server isolation', () => {
    const s = createLevelService(fresh());
    s.setLevelRole(G, 5, R1); s.setLevelRole(G, 5, R2); assert.deepStrictEqual(s.listLevelRoles(G), [{ level: 5, roleId: R2 }]);
    assert.throws(() => s.setLevelRole(G, 0, R1), LevelServiceError);
    s.setBoost(G, R2, 200); s.addIgnore(G, 'role', R2); s.removeRoleEverywhere(G, R2);
    assert.strictEqual(s.listLevelRoles(G).length, 0); assert.strictEqual(s.listBoosts(G).length, 0); assert.strictEqual(s.listIgnores(G).length, 0);
    assert.throws(() => s.setBoost(G, R1, 5), LevelServiceError);
    for (let i = 1; i <= s.MAX_LEVEL_ROLES; i++) s.setLevelRole(G, i, R1);
    assert.throws(() => s.setLevelRole(G, 100, R1), LevelServiceError);
    s.addXp(G, U, 500); assert.strictEqual(s.getUser('999999999999999999', U).xp, 0);
    assert.strictEqual(s.resetGuild(G), 1); assert.strictEqual(s.getUser(G, U).xp, 0);
});
test('level service: voice XP needs the setting on', () => {
    const s = createLevelService(fresh()); s.setConfig(G, { enabled: true });
    assert.strictEqual(s.awardVoice({ guildId: G, userId: U, channelId: C1 }), null);
    s.setConfig(G, { voiceXp: 10 }); assert.strictEqual(s.awardVoice({ guildId: G, userId: U, channelId: C1 }).gained, 10);
    assert.deepStrictEqual(s.guildsWithVoiceXp(), [G]);
});

test('anti-nuke alert role: optional, validated, off by default', () => {
    const c = createAntinukeConfigService(fresh());
    assert.strictEqual(c.getEffective(G).alertRoleId, null);
    c.setAlertRole(G, R1); assert.strictEqual(c.getEffective(G).alertRoleId, R1);
    assert.throws(() => c.setAlertRole(G, 'nope'), TypeError);
    c.setAlertRole(G, null); assert.strictEqual(c.getEffective(G).alertRoleId, null);
    assert.strictEqual(c.getEffective('999999999999999999').alertRoleId, null);
});
