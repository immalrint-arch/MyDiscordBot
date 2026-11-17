const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createCaseService } = require('../src/services/caseService');
const { createEscalationService, EscalationServiceError } = require('../src/services/escalationService');
const E = require('../src/moderation/escalation');
const flow = require('../src/moderation/escalationFlow');
const B = require('../src/modextras/banlist');
const banlist = require('../src/commands/moderation/banlist');
const massban = require('../src/commands/moderation/massban');

const G = '111111111111111111', G2 = '333333333333333333', U = '222222222222222221', MOD = '222222222222222222', BOT = '999999999999999999', OWNER = '222222222222222229';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };

test('rules: validate, pick, describe', () => {
    assert.deepStrictEqual(E.validateRule({ threshold: 3, action: 'timeout', durationMinutes: 60 }).rule, { threshold: 3, action: 'timeout', durationMinutes: 60 });
    assert.deepStrictEqual(E.validateRule({ threshold: 5, action: 'ban', durationMinutes: 99 }).rule, { threshold: 5, action: 'ban', durationMinutes: null });
    for (const bad of [{ threshold: 0, action: 'ban' }, { threshold: 51, action: 'ban' }, { threshold: 2.5, action: 'ban' }, { threshold: 2, action: 'mute' }, { threshold: 2, action: 'timeout' }, { threshold: 2, action: 'timeout', durationMinutes: 40321 }]) assert.ok(E.validateRule(bad).problem, JSON.stringify(bad));
    const rules = [{ threshold: 3, action: 'timeout', durationMinutes: 60 }, { threshold: 5, action: 'ban', durationMinutes: null }];
    assert.strictEqual(E.pickRule(rules, 3).action, 'timeout'); assert.strictEqual(E.pickRule(rules, 4), null);
    assert.strictEqual(E.describeRule(rules[0]), '3 warnings → timeout for 1 hour'); assert.strictEqual(E.describeRule({ threshold: 1, action: 'kick' }), '1 warning → kick'); assert.strictEqual(E.minutesText(1440), '1 day'); assert.strictEqual(E.minutesText(90), '90 minutes');
    assert.strictEqual(E.sinceIso(0, 1000), null); assert.strictEqual(E.sinceIso(1, Date.UTC(2026, 0, 2)), '2026-01-01T00:00:00.000Z');
});
test('service: rules, config, limits, per-server', () => {
    const s = createEscalationService(fresh()); assert.deepStrictEqual(s.getConfig(G), { enabled: false, windowDays: 0 });
    s.setRule(G, { threshold: 3, action: 'timeout', durationMinutes: 60 }); s.setRule(G, { threshold: 3, action: 'kick' }); assert.deepStrictEqual(s.list(G), [{ threshold: 3, action: 'kick', durationMinutes: null }], 'same number replaces');
    assert.strictEqual(s.list(G2).length, 0); assert.throws(() => s.setRule(G, { threshold: 2, action: 'timeout' }), EscalationServiceError);
    s.setEnabled(G, true); s.setWindow(G, 30); assert.deepStrictEqual(s.getConfig(G), { enabled: true, windowDays: 30 }); s.setEnabled(G, false); assert.strictEqual(s.getConfig(G).windowDays, 30);
    assert.throws(() => s.setWindow(G, -1), EscalationServiceError); assert.throws(() => s.setWindow(G, 366), EscalationServiceError);
    for (let i = 1; i < E.MAX_RULES; i++) s.setRule(G, { threshold: 10 + i, action: 'ban' }); assert.throws(() => s.setRule(G, { threshold: 40, action: 'ban' }), EscalationServiceError);
    assert.ok(s.removeRule(G, 3)); assert.ok(!s.removeRule(G, 3));
});
test('cases: countActiveWarnings skips pardoned and old ones', () => {
    const db = fresh(); const cases = createCaseService(db);
    const a = cases.createCase({ guildId: G, type: 'warn', targetId: U, moderatorId: MOD, reason: 'a' }); cases.createCase({ guildId: G, type: 'warn', targetId: U, moderatorId: MOD, reason: 'b' }); cases.createCase({ guildId: G, type: 'note', targetId: U, moderatorId: MOD, reason: 'n' });
    assert.strictEqual(cases.countActiveWarnings(G, U), 2); cases.deactivateWarning(G, a.caseNumber); assert.strictEqual(cases.countActiveWarnings(G, U), 1);
    assert.strictEqual(cases.countActiveWarnings(G, U, '2999-01-01T00:00:00.000Z'), 0); assert.strictEqual(cases.countActiveWarnings(G, U, '2000-01-01T00:00:00.000Z'), 1); assert.strictEqual(cases.countActiveWarnings(G2, U), 0);
});

function world({ enabled = true, canAct = true, dmOn = false } = {}) {
    const db = fresh(); const cases = createCaseService(db); const escalation = createEscalationService(db); escalation.setEnabled(G, enabled);
    const calls = []; const said = []; const logs = []; const marks = [];
    const member = { id: U, moderatable: canAct, kickable: canAct, bannable: canAct, timeout: async (ms) => { calls.push(['timeout', ms]); }, kick: async () => { calls.push(['kick']); } };
    const guild = { id: G, name: 'S', ownerId: OWNER, members: { fetchMe: async () => ({ id: BOT, permissions: { has: () => canAct } }), ban: async (id) => { calls.push(['ban', id]); } } };
    const client = { user: { id: BOT, username: 'Incomu' }, services: { cases, escalation, modLog: { send: async (g, p) => { logs.push(p); } }, suppress: { mark: (g, k, id) => marks.push(k) }, guildSettings: { getSettings: () => ({ dmOnAction: dmOn }) } } };
    const interaction = { client, guild, channel: { send: async (p) => { said.push(p); } } };
    const user = { id: U, username: 'sam', send: async () => {} };
    const warn = () => { const record = cases.createCase({ guildId: G, type: 'warn', targetId: U, moderatorId: MOD, reason: 'x' }); return flow.runEscalation(interaction, { record, user, member }); };
    return { cases, escalation, calls, said, logs, marks, warn, interaction, user, member };
}
test('flow: warnings trigger the matching rule exactly once, record a case, and say so', async () => {
    const w = world(); w.escalation.setRule(G, { threshold: 2, action: 'timeout', durationMinutes: 30 }); w.escalation.setRule(G, { threshold: 3, action: 'kick' });
    assert.strictEqual(await w.warn(), null); const r = await w.warn(); assert.strictEqual(r.applied, 'timeout'); assert.deepStrictEqual(w.calls, [['timeout', 30 * 60000]]);
    const auto = w.cases.getCase(G, r.caseNumber); assert.strictEqual(auto.type, 'timeout'); assert.strictEqual(auto.moderatorId, BOT); assert.match(auto.reason, /Automatic: reached 2 warnings/); assert.match(w.said[0].content, /timed out for 30 minutes/); assert.strictEqual(w.logs.length, 1); assert.deepStrictEqual(w.said[0].allowedMentions, { parse: [] });
    assert.ok(w.marks.includes('timeout'), 'event loggers are told to skip our own action');
    assert.strictEqual((await w.warn()).applied, 'kick'); assert.strictEqual(await w.warn(), null, '4th warning: no rule');
});
test('flow: ban rule, disabled, pardoned warnings, window, cannot act, not in server', async () => {
    let w = world(); w.escalation.setRule(G, { threshold: 1, action: 'ban' }); assert.strictEqual((await w.warn()).applied, 'ban'); assert.deepStrictEqual(w.calls, [['ban', U]]); assert.ok(w.marks.includes('ban'));
    w = world({ enabled: false }); w.escalation.setRule(G, { threshold: 1, action: 'ban' }); assert.strictEqual(await w.warn(), null); assert.strictEqual(w.calls.length, 0);
    w = world(); w.escalation.setRule(G, { threshold: 2, action: 'kick' }); const first = w.cases.createCase({ guildId: G, type: 'warn', targetId: U, moderatorId: MOD, reason: 'old' }); w.cases.deactivateWarning(G, first.caseNumber); assert.strictEqual(await w.warn(), null, 'a pardoned warning does not count');
    w = world(); w.escalation.setRule(G, { threshold: 1, action: 'kick' }); w.escalation.setWindow(G, 7); const r = await w.warn(); assert.strictEqual(r.applied, 'kick');
    w = world({ canAct: false }); w.escalation.setRule(G, { threshold: 1, action: 'ban' }); assert.strictEqual((await w.warn()).skipped, 'cannot'); assert.match(w.said[0].content, /cannot ban/); assert.strictEqual(w.calls.length, 0);
    w = world(); w.escalation.setRule(G, { threshold: 1, action: 'ban' }); const rec = w.cases.createCase({ guildId: G, type: 'warn', targetId: U, moderatorId: MOD, reason: 'x' }); assert.strictEqual((await flow.runEscalation(w.interaction, { record: rec, user: w.user, member: null })).skipped, 'not in server');
    w = world(); w.escalation.setRule(G, { threshold: 1, action: 'kick' }); w.member.kick = async () => { throw new Error('Missing Permissions'); }; assert.strictEqual((await w.warn()).skipped, 'failed'); assert.match(w.said[0].content, /could not kick/);
    w = world(); w.escalation.setRule(G, { threshold: 1, action: 'kick' }); w.interaction.guild.ownerId = U; assert.strictEqual((await w.warn()).skipped, 'cannot', 'never acts on the server owner');
});
const cmd = (w, sub, opts = {}, perm = true) => { const out = []; return { out, client: w.interaction.client, guild: w.interaction.guild, guildId: G, user: { id: MOD }, member: {}, memberPermissions: { has: () => perm }, inGuild: () => true, deferred: false, replied: false, reply(p) { out.push(p); return Promise.resolve(); },
    options: { getSubcommand: () => sub, getInteger: (k) => opts[k] ?? null, getString: (k) => opts[k] ?? null, getBoolean: (k) => opts[k] ?? null } }; };
test('flow: /warnescalation command', async () => {
    const w = world({ enabled: false }); const run = async (sub, opts, perm) => { const i = cmd(w, sub, opts, perm); await flow.handleWarnEscalationCommand(i); return JSON.stringify(i.out); };
    assert.match(await run('add', { warnings: 3, action: 'timeout', minutes: 60 }), /3 warnings → timeout for 1 hour.*still \*\*off/); assert.match(await run('add', { warnings: 3, action: 'timeout' }), /needs a length/);
    assert.match(await run('toggle', { enabled: true }), /on/); assert.ok(w.escalation.getConfig(G).enabled); assert.match(await run('window', { days: 30 }), /30 days/); assert.match(await run('window', { days: 0 }), /Every active/);
    assert.match(await run('list'), /3 warnings/); assert.match(await run('remove', { warnings: 3 }), /Removed/); assert.match(await run('remove', { warnings: 3 }), /no rule/); assert.match(await run('list'), /No rules yet/);
    assert.match(await run('add', { warnings: 3, action: 'ban' }, false), /permission/); assert.strictEqual(w.escalation.list(G).length, 0);
});

test('banlist: format and parse round trip, plain lists, junk, duplicates', () => {
    const text = B.formatBanList([{ id: '123456789012345678', username: 'bad"guy', reason: 'raid,\nspam' }, { id: '223456789012345678', username: 'x', reason: null }], { guildName: 'My\nServer', now: Date.UTC(2026, 10, 16) });
    assert.match(text.split('\n')[0], /^# Incomu ban list · My Server · 2026-11-16 · 2 bans$/); assert.deepStrictEqual(B.parseBanFile(text), { ids: ['123456789012345678', '223456789012345678'], skipped: 0 });
    assert.deepStrictEqual(B.parseBanFile('﻿123456789012345678\r\n123456789012345678\r\nhello\r\n"223456789012345678",x\r\n\r\n# c\r\n12345\r\n323456789012345678 spam reason 423456789012345678'), { ids: ['123456789012345678', '223456789012345678', '323456789012345678'], skipped: 2 });
    assert.deepStrictEqual(B.parseBanFile(''), { ids: [], skipped: 0 });
    assert.ok(B.isDiscordFileUrl('https://cdn.discordapp.com/attachments/1/2/a.csv?ex=1')); assert.ok(B.isDiscordFileUrl('https://media.discordapp.net/a.txt')); for (const bad of ['http://cdn.discordapp.com/a', 'https://evil.com/cdn.discordapp.com', 'https://cdn.discordapp.com.evil.com/a', 'file:///etc/passwd', 'nonsense', 'https://127.0.0.1/a']) assert.ok(!B.isDiscordFileUrl(bad), bad);
    assert.ok(B.fileLooksLikeText({ name: 'a.CSV' })); assert.ok(B.fileLooksLikeText({ name: 'noext', contentType: 'text/plain' })); assert.ok(!B.fileLooksLikeText({ name: 'a.exe', contentType: 'application/x-msdownload' }));
});

function banWorld({ bans = [], canBan = true } = {}) {
    const out = []; const me = { id: BOT, permissions: { has: () => canBan } };
    const guild = { id: G, name: 'Home', ownerId: OWNER, members: { fetchMe: async () => me }, bans: { fetch: async () => new Map(bans.map((b) => [b.id, { user: { id: b.id, username: b.username ?? 'u' }, reason: b.reason ?? null }])) } };
    const other = { id: G2, name: 'Other', ownerId: OWNER, members: { fetchMe: async () => me, fetch: async (id) => (id === MOD ? { permissions: { has: () => true } } : null) }, bans: { fetch: async () => new Map([['123456789012345678', { user: { id: '123456789012345678', username: 'a' }, reason: 'r' }], ['223456789012345678', { user: { id: '223456789012345678', username: 'b' }, reason: null }]]) } };
    const interaction = (sub, opts = {}, perm = true) => ({ out, client: { guilds: { cache: new Map([[G2, other]]) } }, guild, guildId: G, user: { id: MOD }, member: {}, memberPermissions: { has: () => perm }, inGuild: () => true, deferred: false, replied: false,
        deferReply: async function (o) { this.deferred = true; this.deferOptions = o; }, reply(p) { out.push(p); return Promise.resolve(); }, editReply(p) { out.push(p); return Promise.resolve(); },
        options: { getSubcommand: () => sub, getString: (k) => opts[k] ?? null, getAttachment: () => opts.file ?? null } });
    return { out, interaction, other };
}
test('banlist: export is private and contains the bans', async () => {
    const w = banWorld({ bans: [{ id: '123456789012345678', username: 'bad', reason: 'raid' }] }); const i = w.interaction('export'); await banlist.execute(i);
    assert.ok(i.deferOptions?.flags !== undefined || JSON.stringify(i.deferOptions).length > 2, 'ephemeral'); assert.strictEqual(w.out.length, 1); assert.match(w.out[0].content, /1 ban exported/); assert.strictEqual(w.out[0].files.length, 1);
    const nope = banWorld({ canBan: false }); const j = nope.interaction('export'); await banlist.execute(j); assert.match(JSON.stringify(nope.out), /Ban Members/); assert.match(JSON.stringify(banWorld().interaction('export', {}, false).deferOptions ?? {}), /./);
});
test('banlist: import and copy show a preview, skip existing bans, and hand off to the massban buttons', async () => {
    massban.pending.clear(); const realFetch = global.fetch; const file = { name: 'bans.csv', size: 100, url: 'https://cdn.discordapp.com/attachments/1/2/bans.csv', contentType: 'text/csv' };
    try {
        global.fetch = async () => ({ ok: true, text: async () => '# header\nuser_id,username,reason\n123456789012345678,a,"r"\n223456789012345678,b,\n323456789012345678\nnotanid\n' });
        let w = banWorld({ bans: [{ id: '223456789012345678' }] }); let i = w.interaction('import', { file, reason: 'raiders' }); await banlist.execute(i);
        const text = w.out[0].content; assert.match(text, /Ban 2 accounts/); assert.match(text, /1 already banned/); assert.match(text, /1 line had no ID/); assert.match(text, /raiders/); assert.ok(w.out[0].components.length);
        const [job] = [...massban.pending.values()]; assert.deepStrictEqual(job.ids, ['123456789012345678', '323456789012345678']); assert.strictEqual(job.moderatorId, MOD); assert.match(job.reason, /Ban list import: raiders/);
        w = banWorld(); i = w.interaction('import', { file: { ...file, name: 'x.exe', contentType: 'application/octet-stream' } }); await banlist.execute(i); assert.match(JSON.stringify(w.out), /must be a/);
        w = banWorld(); i = w.interaction('import', { file: { ...file, size: 5_000_000 } }); await banlist.execute(i); assert.match(JSON.stringify(w.out), /too big/);
        w = banWorld(); i = w.interaction('import', { file: { ...file, url: 'https://evil.example/a.csv' } }); await banlist.execute(i); assert.match(JSON.stringify(w.out), /uploaded to Discord/);
        w = banWorld(); i = w.interaction('import', {}); await banlist.execute(i); assert.match(JSON.stringify(w.out), /Attach/);
        global.fetch = async () => ({ ok: true, text: async () => 'nothing useful' }); w = banWorld(); i = w.interaction('import', { file }); await banlist.execute(i); assert.match(JSON.stringify(w.out), /no user IDs/);
        global.fetch = async () => { throw new Error('offline'); }; w = banWorld(); i = w.interaction('import', { file }); await banlist.execute(i); assert.match(JSON.stringify(w.out), /could not download/);
        global.fetch = async () => ({ ok: true, text: async () => Array.from({ length: 301 }, (_, n) => `1${String(n).padStart(17, '0')}`).join('\n') }); w = banWorld(); i = w.interaction('import', { file }); await banlist.execute(i); assert.match(JSON.stringify(w.out), /limit is 300/);
        global.fetch = async () => ({ ok: true, text: async () => `${OWNER}\n${MOD}\n${BOT}\n` }); w = banWorld(); i = w.interaction('import', { file }); await banlist.execute(i); assert.match(JSON.stringify(w.out), /Nothing to ban/);
    } finally { global.fetch = realFetch; massban.pending.clear(); }
    let w = banWorld(); let i = w.interaction('copy', { server: G2, reason: 'same community' }); await banlist.execute(i); assert.match(w.out[0].content, /Ban 2 accounts/); assert.match(w.out[0].content, /server \*\*Other\*\*/);
    w = banWorld(); i = w.interaction('copy', { server: '555555555555555555' }); await banlist.execute(i); assert.match(JSON.stringify(w.out), /not in a server/);
    w = banWorld(); i = w.interaction('copy', { server: G }); await banlist.execute(i); assert.match(JSON.stringify(w.out), /not in a server|this server/);
    w = banWorld(); w.other.members.fetch = async () => null; i = w.interaction('copy', { server: G2 }); await banlist.execute(i); assert.match(JSON.stringify(w.out), /Ban Members.*Other/);
    w = banWorld(); i = w.interaction('import', {}, false); await banlist.execute(i); assert.match(JSON.stringify(w.out), /permission/); massban.pending.clear();
});
test('command files load', () => {
    for (const [file, name] of [['warnescalation', 'warnescalation'], ['banlist', 'banlist']]) { const c = require(`../src/commands/moderation/${file}`); assert.strictEqual(c.data.name, name); assert.strictEqual(typeof c.execute, 'function'); }
    const so = require('../src/textcommands/slashOnly'); assert.ok((so.SLASH_ONLY ?? so).has('banlist'));
});
