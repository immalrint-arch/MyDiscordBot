const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createVoiceTimeService } = require('../src/services/voiceTimeService');
const flow = require('../src/voicetime/voiceTimeFlow');
const { dayNumber } = require('../src/leveling/xpMath');

const G = '111111111111111111', G2 = '333333333333333333', A = '222222222222222221', B = '222222222222222222', C = '222222222222222223', AFK = '444444444444444449';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };
const NOW = Date.UTC(2026, 10, 18, 12, 0); // a Wednesday
const DAY = dayNumber(NOW);

test('formatMinutes', () => {
    assert.strictEqual(flow.formatMinutes(0), '0m'); assert.strictEqual(flow.formatMinutes(59), '59m'); assert.strictEqual(flow.formatMinutes(60), '1h 0m'); assert.strictEqual(flow.formatMinutes(200), '3h 20m');
    assert.strictEqual(flow.formatMinutes(1440), '1d 0h'); assert.strictEqual(flow.formatMinutes(1440 + 125), '1d 2h'); assert.strictEqual(flow.formatMinutes(-5), '0m'); assert.strictEqual(flow.formatMinutes(90.7), '1h 30m');
});
test('service: counting, periods, rank, top, reset, purge, isolation', () => {
    const s = createVoiceTimeService(fresh()); assert.ok(!s.isEnabled(G)); s.setEnabled(G, true); assert.ok(s.isEnabled(G)); assert.deepStrictEqual(s.enabledGuilds(), [G]);
    for (let i = 0; i < 5; i++) s.addMinute(G, [A, B], DAY); for (let i = 0; i < 3; i++) s.addMinute(G, [A], DAY - 10); s.addMinute(G, [C], DAY - 1);
    assert.strictEqual(s.total(G, A), 8); assert.strictEqual(s.total(G, B), 5); assert.strictEqual(s.total(G2, A), 0);
    assert.strictEqual(s.between(G, A, DAY, DAY), 5); assert.strictEqual(s.between(G, A, DAY - 10, DAY), 8);
    assert.deepStrictEqual(s.top(G).map((t) => [t.userId, t.minutes]), [[A, 8], [B, 5], [C, 1]]); assert.deepStrictEqual(s.top(G, { startDay: DAY, endDay: DAY }).map((t) => [t.userId, t.minutes]), [[A, 5], [B, 5]]);
    assert.strictEqual(s.rank(G, A), 1); assert.strictEqual(s.rank(G, B), 2); assert.strictEqual(s.rank(G, '222222222222222229'), null);
    assert.strictEqual(s.addMinute(G, [], DAY), 0); assert.strictEqual(s.total(G, A), 8); assert.strictEqual(s.purgeOldDaily(DAY - 5), 1); assert.strictEqual(s.total(G, A), 8, 'totals are kept'); assert.strictEqual(s.between(G, A, DAY - 10, DAY - 1), 0);
    assert.ok(s.resetUser(G, A)); assert.ok(!s.resetUser(G, A)); assert.strictEqual(s.total(G, A), 0); assert.strictEqual(s.between(G, A, 0, DAY), 0); assert.strictEqual(s.countPeople(G), 2);
});

const member = (id, { bot = false, deaf = false, sdeaf = false } = {}) => ({ id, user: { bot }, voice: { selfDeaf: deaf, serverDeaf: sdeaf } });
function world({ enabled = true } = {}) {
    const svc = createVoiceTimeService(fresh()); if (enabled) svc.setEnabled(G, true);
    const chan = (id, members) => ({ id, isVoiceBased: () => true, members: new Map(members.map((m) => [m.id, m])) });
    const guild = { id: G, afkChannelId: AFK, channels: { cache: new Map([['1', chan('444444444444444441', [member(A), member(B, { deaf: true }), member('222222222222222224', { bot: true })])], ['2', chan(AFK, [member(C)])], ['3', { id: '9', isVoiceBased: () => false, members: new Map() }], ['4', chan('444444444444444442', [member('222222222222222225', { sdeaf: true }), member('222222222222222226')])]]) } };
    const client = { guilds: { cache: new Map([[G, guild]]) }, services: { voiceTime: svc } };
    return { svc, client };
}
test('tick: counts people in voice, skips bots, deafened members and the AFK channel; only enabled servers', () => {
    const w = world(); flow.voiceTimeTick(w.client, NOW); assert.deepStrictEqual(w.svc.top(G).map((t) => t.userId).sort(), [A, '222222222222222226'].sort()); assert.strictEqual(w.svc.total(G, A), 1);
    flow.voiceTimeTick(w.client, NOW + 60000); assert.strictEqual(w.svc.total(G, A), 2);
    const off = world({ enabled: false }); flow.voiceTimeTick(off.client, NOW); assert.strictEqual(off.svc.top(G).length, 0);
});

const cmd = (w, sub, opts = {}, perm = true) => { const out = []; return { out, client: w.client, guildId: G, user: { id: A }, member: {}, memberPermissions: { has: () => perm }, inGuild: () => true, deferred: false, replied: false, reply(p) { out.push(p); return Promise.resolve(); },
    options: { getSubcommand: () => sub, getUser: () => (opts.user ? { id: opts.user } : null), getString: (k) => opts[k] ?? null, getBoolean: (k) => opts[k] ?? null } }; };
test('command: enable/disable need permission, stats and top read the numbers, reset works', async () => {
    const w = world({ enabled: false }); const run = async (sub, opts, perm) => { const i = cmd(w, sub, opts, perm); await flow.handleVoiceTimeCommand(i, { nowMs: NOW }); return JSON.stringify(i.out); };
    assert.match(await run('stats'), /turn it on/); assert.match(await run('enable', {}, false), /permission/); assert.ok(!w.svc.isEnabled(G));
    assert.match(await run('enable'), /on/); assert.match(await run('stats'), /no voice time yet/);
    for (let i = 0; i < 90; i++) w.svc.addMinute(G, [A], DAY); w.svc.addMinute(G, [B], DAY - 30);
    const stats = await run('stats'); assert.match(stats, /1h 30m/); assert.match(stats, /#1/); assert.match(await run('stats', { user: B }), /1m/);
    assert.match(await run('top'), /All time/); assert.match(await run('top'), new RegExp(`<@${A}>`)); assert.match(await run('top', { period: 'daily' }), /Today/); assert.ok(!(await run('top', { period: 'daily' })).includes(`<@${B}>`));
    assert.match(await run('top', { period: 'daily', previous: true }), /Nobody has spent/); assert.match(await run('top', { period: 'monthly' }), /This month/);
    assert.match(await run('reset', { user: A }, false), /permission/); assert.match(await run('reset', { user: A }), /Erased/); assert.match(await run('stats'), /no voice time/);
    assert.match(await run('disable'), /off/); assert.ok(!w.svc.isEnabled(G));
});
test('command file loads', () => { const c = require('../src/commands/leveling/voicetime'); assert.strictEqual(c.data.name, 'voicetime'); assert.strictEqual(typeof c.execute, 'function'); });
