const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createRaidService } = require('../src/services/raidService');
const rules = require('../src/raid/rules');
const flow = require('../src/raid/raidFlow');

const G = '111111111111111111', G2 = '333333333333333333', ALERT = '444444444444444441', ROLE = '555555555555555551', ST = '888888888888888881';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };
let clock = 5_000_000; const svcOf = (db) => createRaidService(db, { now: () => (clock += 1000) });
const uid = (n) => `20000000000000${String(1000 + n)}`;

test('rules: tracker trips only for enough joins inside the window', () => {
    const t = rules.createJoinTracker(); const c = { joins: 4, seconds: 10 };
    assert.strictEqual(t.record(G, uid(1), 0, c), null); assert.strictEqual(t.record(G, uid(2), 3000, c), null); assert.strictEqual(t.record(G, uid(3), 6000, c), null);
    assert.deepStrictEqual(t.record(G, uid(4), 9000, c), [uid(1), uid(2), uid(3), uid(4)]);
    assert.strictEqual(t.record(G, uid(5), 9500, c), null, 'counter restarts after tripping');
    const t2 = rules.createJoinTracker(); for (let i = 0; i < 10; i++) assert.strictEqual(t2.record(G, uid(i), i * 20000, c), null, 'slow joins never trip');
    const t3 = rules.createJoinTracker(); t3.record(G, uid(1), 0, c); t3.record(G, uid(1), 100, c); t3.record(G, uid(1), 200, c); assert.strictEqual(t3.record(G, uid(1), 300, c), null, 'the same person rejoining does not add up');
    const t4 = rules.createJoinTracker(); t4.record(G, uid(1), 0, c); t4.record(G2, uid(2), 1, c); t4.record(G2, uid(3), 2, c); assert.strictEqual(t4.record(G2, uid(4), 3, c), null, 'servers are separate');
});
test('rules: limits, expiry, text', () => {
    assert.ok(rules.checkSetting('joins', 10)); assert.ok(!rules.checkSetting('joins', 2)); assert.ok(!rules.checkSetting('seconds', 301)); assert.ok(!rules.checkSetting('duration_minutes', 1.5));
    assert.ok(!rules.isExpired(1000, 15, 1000 + 14 * 60000)); assert.ok(rules.isExpired(1000, 15, 1000 + 15 * 60000)); assert.match(rules.describeAction('kick'), /kick/);
});

test('service: config, one active raid, end once, history, isolation', () => {
    const db = fresh(); const s = svcOf(db);
    assert.deepStrictEqual(s.getConfig(G), { enabled: false, joins: 10, seconds: 30, action: 'alert', durationMinutes: 15, alertChannelId: null, alertRoleId: null, raiseVerification: true, pauseInvites: true });
    assert.ok(!s.isEnabled(G)); const c = s.configure(G, { enabled: true, joins: 5, action: 'kick', alertChannelId: ALERT, alertRoleId: ROLE }); assert.ok(c.enabled && c.joins === 5 && c.action === 'kick' && c.seconds === 30); assert.ok(s.isEnabled(G)); assert.ok(!s.isEnabled(G2));
    assert.throws(() => s.configure(G, { joins: 1 }), /joins/); assert.throws(() => s.configure(G, { seconds: 1000 }), /seconds/); assert.throws(() => s.configure(G, { action: 'ban' }), /action/); assert.throws(() => s.configure(G, { durationMinutes: 0 }), /duration/);
    assert.strictEqual(s.getConfig(G).joins, 5, 'bad values change nothing'); s.configure(G, { enabled: false }); assert.ok(!s.isEnabled(G)); assert.strictEqual(s.getConfig(G).joins, 5);
    const id = s.start(G, { raiders: 5, prevVerification: 1, setVerification: 3, invitesPaused: true }); assert.ok(id); assert.strictEqual(s.start(G, {}), null, 'only one active'); assert.ok(s.start(G2, {}), 'other server independent');
    s.addRaider(id, 2); assert.strictEqual(s.active(G).raiders, 7); const done = s.end(id, ST); assert.strictEqual(done.prevVerification, 1); assert.strictEqual(s.end(id, ST), null, 'only once'); assert.strictEqual(s.active(G), null);
    assert.ok(s.start(G, {}), 'can start again after ending'); assert.strictEqual(s.history(G).length, 1); assert.strictEqual(s.activeEvents().length, 2);
});

// ---- flow with a fake server ----
function world({ level = 1, invites = false, canInvites = true, action = 'alert', joins = 3, withAlert = true } = {}) {
    clock += 100000; const db = fresh(); const raid = svcOf(db); const log = { levels: [], invites: [], sent: [], edited: [], punished: [] };
    const members = new Map(); const mk = (id, bot = false) => { const m = { id, user: { id, bot }, kickable: true, moderatable: true, kick: async () => log.punished.push(['kick', id]), timeout: async (ms) => log.punished.push(['timeout', id, ms]) }; members.set(id, m); return m; };
    const msg = { id: '777777777777777771', edit: async (o) => { log.edited.push(o); } };
    const alert = { id: ALERT, send: async (o) => { log.sent.push(o); return msg; }, messages: { fetch: async () => msg } };
    const guild = { id: G, verificationLevel: level, invitesDisabled: invites, members: { cache: members, fetch: async (id) => members.get(id) ?? null }, channels: { cache: new Map([[ALERT, alert]]), fetch: async () => alert },
        setVerificationLevel: async (l) => { log.levels.push(l); guild.verificationLevel = l; } };
    if (canInvites) guild.disableInvites = async (b) => { log.invites.push(b); guild.invitesDisabled = b; };
    const client = { guilds: { cache: new Map([[G, guild]]) }, services: { raid } };
    raid.configure(G, { enabled: true, joins, seconds: 30, action, durationMinutes: 15, alertChannelId: withAlert ? ALERT : undefined, alertRoleId: ROLE });
    flow.tracker.clear(G); return { client, guild, raid, log, mk };
}
const join = (w, n, at, bot = false) => { const m = w.mk(uid(n), bot); m.client = w.client; m.guild = w.guild; return flow.handleRaidJoin(m, { nowMs: at }); };

test('flow: a surge starts raid mode: verification up, invites paused, staff alerted, old settings remembered', async () => {
    const w = world(); await join(w, 1, 0); await join(w, 2, 1000); assert.strictEqual(w.raid.active(G), null); await join(w, 3, 2000);
    const ev = w.raid.active(G); assert.ok(ev); assert.strictEqual(ev.raiders, 3); assert.strictEqual(ev.prevVerification, 1); assert.strictEqual(ev.setVerification, 3); assert.ok(ev.invitesPaused);
    assert.deepStrictEqual(w.log.levels, [3]); assert.deepStrictEqual(w.log.invites, [true]); assert.strictEqual(w.log.sent.length, 1);
    assert.deepStrictEqual(w.log.sent[0].allowedMentions, { roles: [ROLE] }); assert.ok(w.log.sent[0].components); assert.strictEqual(ev.alertMessageId, '777777777777777771'); assert.strictEqual(w.log.punished.length, 0, 'alert only');
});
test('flow: during a raid new joiners are counted and punished; bots are ignored; restart of the clock', async () => {
    const w = world({ action: 'timeout' }); for (let i = 1; i <= 3; i++) await join(w, i, i * 100);
    assert.strictEqual(w.log.punished.length, 3); assert.ok(w.log.punished.every((p) => p[0] === 'timeout' && p[2] === rules.TIMEOUT_MS));
    const before = w.raid.active(G).lastJoinAt; await join(w, 9, 5000); assert.strictEqual(w.raid.active(G).raiders, 4); assert.ok(w.raid.active(G).lastJoinAt > before); assert.strictEqual(w.log.punished.length, 4);
    await join(w, 10, 5100, true); assert.strictEqual(w.raid.active(G).raiders, 4, 'bot not counted'); assert.strictEqual(w.log.punished.length, 4);
    const k = world({ action: 'kick' }); for (let i = 1; i <= 3; i++) await join(k, i, i); k.mk(uid(50)).kickable = false; assert.deepStrictEqual(k.log.punished.map((p) => p[0]), ['kick', 'kick', 'kick']);
});
test('flow: not enabled → nothing happens; verification already High is left alone; no invite support is handled', async () => {
    const w = world(); w.raid.configure(G, { enabled: false }); for (let i = 1; i <= 5; i++) await join(w, i, i); assert.strictEqual(w.raid.active(G), null);
    const h = world({ level: 3 }); for (let i = 1; i <= 3; i++) await join(h, i, i); assert.deepStrictEqual(h.log.levels, []); assert.strictEqual(h.raid.active(G).prevVerification, null);
    const o = world({ canInvites: false, withAlert: false }); for (let i = 1; i <= 3; i++) await join(o, i, i); assert.ok(o.raid.active(G)); assert.ok(!o.raid.active(G).invitesPaused); assert.strictEqual(o.log.sent.length, 0);
    const p = world({ invites: true }); for (let i = 1; i <= 3; i++) await join(p, i, i); assert.ok(!p.raid.active(G).invitesPaused, 'invites were already paused by an admin');
});
test('flow: ending puts back only what we changed, only once, and edits the alert', async () => {
    const w = world(); for (let i = 1; i <= 3; i++) await join(w, i, i);
    const [a, b] = await Promise.all([flow.endRaid(w.client, G, ST), flow.endRaid(w.client, G, ST)]); assert.ok((a && !b) || (!a && b));
    assert.deepStrictEqual(w.log.levels, [3, 1]); assert.deepStrictEqual(w.log.invites, [true, false]); assert.strictEqual(w.log.edited.length, 1); assert.strictEqual(w.raid.active(G), null);
    const m = world(); for (let i = 1; i <= 3; i++) await join(m, i, i); m.guild.verificationLevel = 4; await flow.endRaid(m.client, G, 'auto'); assert.deepStrictEqual(m.log.levels, [3], 'an admin changed it meanwhile: do not overwrite');
    assert.strictEqual(await flow.endRaid(m.client, G, ST), null);
});
test('flow: manual start, double start, and the 30-second check ends old raids', async () => {
    const w = world(); const ev = await flow.startRaid(w.client, w.guild, { auto: false }); assert.ok(ev && !ev.auto); assert.strictEqual(await flow.startRaid(w.client, w.guild, { auto: false }), null);
    assert.deepStrictEqual(w.log.levels, [3], 'the second start must not touch settings'); assert.deepStrictEqual(w.log.invites, [true]);
    const realNow = Date.now; Date.now = () => realNow() + 16 * 60 * 1000; const timers = []; const orig = global.setInterval; global.setInterval = (fn) => { timers.push(fn); return 0; };
    try { flow.startRaidScheduler(w.client); await timers[0](); await new Promise((r) => setTimeout(r, 20)); } finally { Date.now = realNow; global.setInterval = orig; }
    assert.strictEqual(w.raid.active(G), null); assert.deepStrictEqual(w.log.levels, [3, 1]);
});
test('buttons and commands: staff only, right server', async () => {
    const w = world(); await flow.startRaid(w.client, w.guild, { auto: false });
    const click = (member, guildId = G) => { const r = []; return { r, client: w.client, customId: `rm:end:${G}`, guildId, member, user: { id: ST }, reply: async (o) => r.push(o) }; };
    let i = click({ permissions: { has: () => false } }); await flow.handleRaidComponent(i); assert.match(i.r[0].content, /Manage Server/); assert.ok(w.raid.active(G));
    i = click({ permissions: { has: () => true } }, G2); await flow.handleRaidComponent(i); assert.ok(w.raid.active(G), 'wrong server');
    i = click({ permissions: { has: () => true } }); await flow.handleRaidComponent(i); assert.strictEqual(w.raid.active(G), null);
    const c = require('../src/commands/security/raidmode'); assert.strictEqual(c.data.name, 'raidmode'); assert.strictEqual(require('../src/events/raid/raidJoin').name, 'guildMemberAdd');
    const { CATEGORIES } = require('../src/help/catalog'); assert.ok(CATEGORIES.some((x) => x.commands.includes('raidmode')));
});
