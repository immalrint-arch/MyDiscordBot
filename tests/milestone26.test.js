const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createQotdService } = require('../src/services/qotdService');
const rules = require('../src/qotd/rules');
const BANK = require('../src/qotd/bank');
const flow = require('../src/qotd/qotdFlow');

const G = '111111111111111111', G2 = '333333333333333333', CH = '444444444444444441', ROLE = '555555555555555551', ST = '888888888888888881';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };
const T0 = Date.UTC(2026, 10, 18, 0, 0); // midnight UTC
const svc = (db, nowMs = T0) => createQotdService(db, { now: () => nowMs, random: () => 0 });

test('rules: time, offset, question cleaning, due logic, thread name', () => {
    assert.deepStrictEqual(rules.parseTime('9:05'), { hour: 9, minute: 5 }); assert.deepStrictEqual(rules.parseTime(' 23:59 '), { hour: 23, minute: 59 });
    for (const bad of ['24:00', '9:60', '9', 'nine', '', null, '9am']) assert.strictEqual(rules.parseTime(bad), null, String(bad));
    assert.strictEqual(rules.formatTime(9, 5), '09:05'); assert.ok(rules.validOffset(8) && rules.validOffset(-12) && !rules.validOffset(15) && !rules.validOffset(1.5));
    assert.ok(!rules.cleanQuestion('short').ok); assert.ok(!rules.cleanQuestion('x'.repeat(301)).ok); const c = rules.cleanQuestion('  Hey   @everyone   what\nis up?  '); assert.ok(c.ok); assert.ok(!c.text.includes('@everyone')); assert.ok(!/\n/.test(c.text));
    const cfg = { hour: 9, minute: 0, utcOffset: 8 }; // 09:00 at UTC+8 = 01:00 UTC
    assert.ok(!rules.isDue(cfg, null, Date.UTC(2026, 10, 18, 0, 59)), 'local 08:59'); assert.ok(rules.isDue(cfg, null, Date.UTC(2026, 10, 18, 1, 0)), 'local 09:00');
    const day = rules.localClock(Date.UTC(2026, 10, 18, 1, 0), 8).day; assert.ok(!rules.isDue(cfg, day, Date.UTC(2026, 10, 18, 5, 0)), 'already posted today'); assert.ok(rules.isDue(cfg, day - 1, Date.UTC(2026, 10, 18, 5, 0)));
    assert.ok(rules.threadName(7, 'x'.repeat(300)).length <= 90); assert.ok(BANK.length >= 40 && new Set(BANK).size === BANK.length && BANK.every((q) => q.length >= 10 && q.length <= 300));
});

test('service: config rules', () => {
    const s = svc(fresh()); assert.deepStrictEqual(s.getConfig(G), { enabled: false, channelId: null, roleId: null, hour: 9, minute: 0, utcOffset: 0, useThreads: true, useBuiltin: true, lastDay: null, counter: 0 });
    assert.throws(() => s.configure(G, { enabled: true }), /setup/); assert.throws(() => s.configure(G, { utcOffset: 20 }), /utc_offset/); assert.throws(() => s.configure(G, { hour: 24 }), /hour/);
    const c = s.configure(G, { enabled: true, channelId: CH, roleId: ROLE, hour: 18, minute: 30, utcOffset: 8, useThreads: false }); assert.ok(c.enabled && c.hour === 18 && c.minute === 30 && !c.useThreads && c.useBuiltin);
    s.configure(G, { enabled: false }); assert.ok(!s.getConfig(G).enabled && s.getConfig(G).channelId === CH); assert.strictEqual(s.enabledGuilds().length, 0); assert.strictEqual(s.getConfig(G2).enabled, false);
});
test('service: own questions first, then built-in, no repeats until everything used', () => {
    const s = svc(fresh()); s.configure(G, { enabled: true, channelId: CH });
    const a = s.addQuestion(G, 'What is your favourite colour and why?', ST), b = s.addQuestion(G, 'Which snack do you always buy first?', ST);
    assert.throws(() => s.addQuestion(G, 'what is your favourite colour and why?', ST), /already/);
    assert.strictEqual(s.pickQuestion(G).id, a); assert.strictEqual(s.pickQuestion(G).id, b);
    const seen = new Set(); for (let i = 0; i < BANK.length; i++) { const p = s.pickQuestion(G); assert.strictEqual(p.source, 'builtin'); assert.ok(!seen.has(p.text), 'no repeat'); seen.add(p.text); }
    assert.strictEqual(seen.size, BANK.length); const next = s.pickQuestion(G); assert.strictEqual(next.source, 'own', 'a new round starts with an own question'); assert.strictEqual(s.builtinSeen(G), 0);
});
test('service: only built-in, only own, none, and isolation', () => {
    const s = svc(fresh()); s.configure(G, { enabled: true, channelId: CH }); const seen = new Set(); for (let i = 0; i < BANK.length + 3; i++) seen.add(s.pickQuestion(G).text); assert.strictEqual(seen.size, BANK.length, 'cycles after everything was used');
    s.configure(G2, { enabled: true, channelId: CH, useBuiltin: false }); assert.throws(() => s.pickQuestion(G2), /no questions/);
    const id = s.addQuestion(G2, 'Only mine for this server please?', ST); assert.strictEqual(s.pickQuestion(G2).id, id); assert.strictEqual(s.pickQuestion(G2).id, id, 'single own question repeats');
    assert.strictEqual(s.countQuestions(G), 0); assert.ok(s.removeQuestion(G2, id)); assert.ok(!s.removeQuestion(G2, id)); assert.ok(!s.removeQuestion(G, id));
    for (let i = 0; i < 200; i++) s.addQuestion(G, `Question number ${i} is here for testing?`, ST); assert.throws(() => s.addQuestion(G, 'One question too many for this list?', ST), /200/);
});
test('service: one claim per local day', () => {
    const s = svc(fresh()); s.configure(G, { enabled: true, channelId: CH, utcOffset: 8 }); const t = Date.UTC(2026, 10, 18, 3, 0);
    assert.ok(s.claimDay(G, t)); assert.ok(!s.claimDay(G, t + 1000)); assert.ok(s.claimDay(G, t + 24 * 3600 * 1000)); s.configure(G, { enabled: false }); assert.ok(!s.claimDay(G, t + 48 * 3600 * 1000), 'disabled: no claim');
    assert.strictEqual(s.nextNumber(G), 1); assert.strictEqual(s.nextNumber(G), 2);
});

// ---- flow ----
function world({ channel = true, threads = true } = {}) {
    const db = fresh(); const log = { sent: [], threads: [] }; const qotd = svc(db, Date.UTC(2026, 10, 18, 12, 0));
    const message = { startThread: async (o) => { log.threads.push(o); } };
    const ch = { id: CH, send: async (o) => { log.sent.push(o); return message; } };
    const guild = { id: G, channels: { cache: new Map(channel ? [[CH, ch]] : []), fetch: async () => null } };
    const client = { guilds: { cache: new Map([[G, guild]]) }, services: { qotd } };
    qotd.configure(G, { enabled: true, channelId: CH, roleId: ROLE, hour: 9, minute: 0, utcOffset: 0, useThreads: threads });
    return { client, qotd, log };
}
test('flow: post sends embed, pings only the role, opens a thread, counts', async () => {
    const w = world(); const r = await flow.postQuestion(w.client, G); assert.ok(r.ok); assert.strictEqual(r.number, 1);
    assert.strictEqual(w.log.sent.length, 1); assert.deepStrictEqual(w.log.sent[0].allowedMentions, { roles: [ROLE] }); assert.strictEqual(w.log.sent[0].content, `<@&${ROLE}>`); assert.strictEqual(w.log.threads.length, 1); assert.ok(w.log.threads[0].name.startsWith('QOTD #1'));
    const n = world({ threads: false }); await flow.postQuestion(n.client, G); assert.strictEqual(n.log.threads.length, 0);
    const none = world({ channel: false }); const bad = await flow.postQuestion(none.client, G); assert.ok(!bad.ok); assert.match(bad.error, /channel/);
});
test('flow: scheduler posts once per day, only when due, and not before the time', async () => {
    const w = world(); await flow.qotdTick(w.client, Date.UTC(2026, 10, 18, 8, 59)); assert.strictEqual(w.log.sent.length, 0);
    await flow.qotdTick(w.client, Date.UTC(2026, 10, 18, 9, 0)); await flow.qotdTick(w.client, Date.UTC(2026, 10, 18, 9, 1)); await Promise.all([flow.qotdTick(w.client, Date.UTC(2026, 10, 18, 20, 0)), flow.qotdTick(w.client, Date.UTC(2026, 10, 18, 20, 0))]);
    assert.strictEqual(w.log.sent.length, 1); await flow.qotdTick(w.client, Date.UTC(2026, 10, 19, 9, 5)); assert.strictEqual(w.log.sent.length, 2);
    w.qotd.configure(G, { enabled: false }); await flow.qotdTick(w.client, Date.UTC(2026, 10, 20, 9, 5)); assert.strictEqual(w.log.sent.length, 2);
});
test('command, help and guide', () => {
    const c = require('../src/commands/fun/qotd'); assert.strictEqual(c.data.name, 'qotd'); const { CATEGORIES } = require('../src/help/catalog'); assert.ok(CATEGORIES.some((x) => x.commands.includes('qotd')));
});
