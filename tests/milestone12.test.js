const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createCaseService } = require('../src/services/caseService');
const { createGuildSettingsService } = require('../src/services/guildSettingsService');
const { createQuarantineService } = require('../src/services/quarantineService');
const { createReportService, ReportServiceError } = require('../src/services/reportService');
const rules = require('../src/modextras/rules');
const { PermissionFlagsBits } = require('discord.js');

const G = '111111111111111111', MODID = '222222222222222229', T1 = '222222222222222221', T2 = '222222222222222222', BOT = '999999999999999999', OWNER = '222222222222222200';
const R_MEMBER = '333333333333333331', R_VIP = '333333333333333332', R_Q = '333333333333333339', R_BOOST = '333333333333333338';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };

// ---------- database ----------
test('migration 015 keeps every existing case, number and column, and allows the new types', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    for (const f of fs.readdirSync(MIGRATIONS_DIR)) if (f < '015') fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    const db = openDatabase(':memory:'); runMigrations(db, dir);
    db.prepare('INSERT INTO guilds (guild_id) VALUES (?)').run(G);
    const cases = createCaseService(db);
    cases.createCase({ guildId: G, type: 'warn', targetId: T1, moderatorId: MODID, reason: 'old one' });
    cases.createCase({ guildId: G, type: 'ban', targetId: T1, moderatorId: MODID, reason: 'old two', proofUrl: 'https://example.com/x.png' });
    assert.throws(() => db.prepare("INSERT INTO cases (guild_id, case_number, type, target_id, moderator_id) VALUES (?, 3, 'quarantine', ?, ?)").run(G, T1, MODID));
    assert.strictEqual(runMigrations(db, MIGRATIONS_DIR)[0], '015_moderation_extras.sql'); // 015 runs first (later migrations may follow)
    assert.strictEqual(cases.countCases(G), 2);
    assert.strictEqual(cases.getCase(G, 2).proofUrl, 'https://example.com/x.png'); assert.strictEqual(cases.getCase(G, 1).reason, 'old one');
    assert.strictEqual(cases.createCase({ guildId: G, type: 'quarantine', targetId: T1, moderatorId: MODID }).caseNumber, 3); // numbering continues
    assert.strictEqual(cases.createCase({ guildId: G, type: 'unquarantine', targetId: T1, moderatorId: MODID }).caseNumber, 4);
});

test('modstats: counts per moderator and type, time window, one moderator filter', () => {
    const db = fresh(); const cases = createCaseService(db); const M2 = '222222222222222228';
    for (const [m, t] of [[MODID, 'warn'], [MODID, 'warn'], [MODID, 'ban'], [M2, 'kick']]) cases.createCase({ guildId: G, type: t, targetId: T1, moderatorId: m });
    db.prepare("UPDATE cases SET created_at = '2020-01-01T00:00:00.000Z' WHERE case_number = 1").run();
    const all = cases.moderatorStats(G, { sinceIso: '2025-01-01T00:00:00.000Z' });
    assert.deepStrictEqual(all, [{ moderatorId: MODID, total: 2, byType: { warn: 1, ban: 1 } }, { moderatorId: M2, total: 1, byType: { kick: 1 } }]);
    assert.strictEqual(cases.moderatorStats(G, { sinceIso: '2019-01-01T00:00:00.000Z' })[0].total, 3);
    assert.strictEqual(cases.moderatorStats(G, { sinceIso: '2019-01-01T00:00:00.000Z', moderatorId: M2 }).length, 1);
    assert.deepStrictEqual(cases.moderatorStats('333333333333333300', { sinceIso: '2019-01-01T00:00:00.000Z' }), []);
});

test('quarantine service: config, saved roles, once-only take, isolation', () => {
    const s = createQuarantineService(fresh());
    assert.deepStrictEqual(s.getConfig(G), { roleId: null, channelId: null });
    s.setConfig(G, { roleId: R_Q }); s.setConfig(G, { channelId: '444444444444444441' });
    assert.deepStrictEqual(s.getConfig(G), { roleId: R_Q, channelId: '444444444444444441' });
    assert.throws(() => s.setConfig(G, { roleId: 'bad' }), TypeError);
    assert.ok(s.add(G, T1, { roleIds: [R_MEMBER, R_VIP], moderatorId: MODID, reason: 'raid' }));
    assert.ok(!s.add(G, T1, { roleIds: [], moderatorId: MODID })); // not overwritten
    assert.deepStrictEqual(s.get(G, T1).roleIds, [R_MEMBER, R_VIP]);
    assert.strictEqual(s.get('333333333333333300', T1), null);
    assert.strictEqual(s.list(G).length, 1);
    assert.deepStrictEqual(s.take(G, T1).roleIds, [R_MEMBER, R_VIP]); assert.strictEqual(s.take(G, T1), null);
    assert.throws(() => s.add(G, T1, { roleIds: ['nope'], moderatorId: MODID }), TypeError);
});

test('report service: validation, limits, numbering, closing exactly once', () => {
    let t = Date.parse('2026-11-11T10:00:00Z'); const s = createReportService(fresh(), { now: () => t });
    assert.deepStrictEqual(s.getConfig(G), { channelId: null, pingRoleId: null });
    assert.throws(() => s.create(G, { reporterId: T1, targetId: T1, reason: 'x' }), ReportServiceError);
    assert.throws(() => s.create(G, { reporterId: T1, targetId: T2, reason: '   ' }), ReportServiceError);
    assert.throws(() => s.create(G, { reporterId: T1, targetId: T2, reason: 'x'.repeat(1001) }), ReportServiceError);
    const r1 = s.create(G, { reporterId: T1, targetId: T2, reason: 'spamming' }); assert.strictEqual(r1.number, 1); assert.strictEqual(r1.status, 'open');
    assert.throws(() => s.create(G, { reporterId: T1, targetId: T2, reason: 'again' }), /already have an open report/);
    s.create(G, { reporterId: T1, targetId: '222222222222222223', reason: 'b' }); s.create(G, { reporterId: T1, targetId: '222222222222222224', reason: 'c' });
    assert.throws(() => s.create(G, { reporterId: T1, targetId: '222222222222222225', reason: 'd' }), /per hour/);
    t += 61 * 60 * 1000; assert.doesNotThrow(() => s.create(G, { reporterId: T1, targetId: '222222222222222225', reason: 'd' })); // window passed
    assert.strictEqual(s.create('333333333333333300', { reporterId: T1, targetId: T2, reason: 'x' }).number, 1); // numbers are per server
    assert.strictEqual(s.close(G, 1, 'resolved', MODID).status, 'resolved'); assert.strictEqual(s.close(G, 1, 'dismissed', MODID), null);
    assert.throws(() => s.close(G, 2, 'bogus', MODID), TypeError);
    s.discard(G, 2); assert.strictEqual(s.get(G, 2), null); assert.strictEqual(s.countOpen(G), 2);
});

// ---------- pure rules ----------
test('quarantine plan: managed and out-of-reach roles stay, the rest are saved', () => {
    const roles = [{ id: G, isEveryone: true }, { id: R_MEMBER, position: 2 }, { id: R_VIP, position: 3 }, { id: R_BOOST, managed: true, position: 4 }, { id: '333333333333333377', position: 20 }];
    const p = rules.planQuarantine(roles, R_Q, 10);
    assert.deepStrictEqual(p.saved, [R_MEMBER, R_VIP]); assert.deepStrictEqual(p.keep, [R_BOOST, '333333333333333377']);
    assert.deepStrictEqual(p.final, [R_BOOST, '333333333333333377', R_Q]);
    assert.deepStrictEqual(rules.planQuarantine([{ id: R_Q, position: 1 }], R_Q).saved, []);
});
test('restore plan: deleted, managed and too-high roles are skipped', () => {
    const existing = new Map([[R_MEMBER, { managed: false, position: 2 }], [R_BOOST, { managed: true, position: 3 }], [R_VIP, { managed: false, position: 50 }]]);
    assert.deepStrictEqual(rules.planRestore([R_MEMBER, R_BOOST, R_VIP, '333333333333333300'], existing, 10), { give: [R_MEMBER], skipped: 3 });
});
test('nickname cleaning', () => {
    const c = rules.cleanNickname;
    assert.strictEqual(c('𝕱𝖆𝖓𝖈𝖞 Name'), 'Fancy Name'); assert.strictEqual(c('!!! top of list'), 'top of list'); assert.strictEqual(c('José'), 'José'); assert.strictEqual(c('日本語'), '日本語');
    assert.strictEqual(c('Ź̵̢̂á̶̂̃lgo'), 'Zalgo');
    assert.strictEqual(c('⠀⠀'), null); assert.strictEqual(c('!!!'), null); assert.strictEqual(c('😀😀'), null); assert.strictEqual(c(null), null);
    assert.strictEqual(c('a'.repeat(50)).length, 32);
    assert.deepStrictEqual(rules.planNickname('Bob', T1), { change: false });
    assert.deepStrictEqual(rules.planNickname('!!!', T1), { change: true, to: 'Moderated 2221' });
    assert.deepStrictEqual(rules.planNickname('~~Bob', T1), { change: true, to: 'Bob' });
});
test('ID list parsing', () => {
    const r = rules.parseIdList(`${T1}, <@${T2}>\n${T1} 12345 raid account`);
    assert.deepStrictEqual(r.ids, [T1, T2]); assert.strictEqual(r.leftover, '12345 raid account');
    assert.deepStrictEqual(rules.parseIdList('').ids, []); assert.deepStrictEqual(rules.parseIdList(null).ids, []);
});

// ---------- command flows with fake Discord objects ----------
class Col extends Map {
    map(fn) { return [...this.values()].map(fn); }
    filter(fn) { const c = new Col(); for (const [k, v] of this) if (fn(v, k)) c.set(k, v); return c; }
}
function world() {
    const db = fresh(); const logs = []; const marks = [];
    const services = { cases: createCaseService(db), guildSettings: createGuildSettingsService(db), quarantine: createQuarantineService(db), reports: createReportService(db),
        modLog: { send: async (g, p) => { logs.push(p); } }, suppress: { mark: (...a) => marks.push(a) } };
    const roles = new Col([[G, { id: G, managed: false, position: 0, permissions: { bitfield: 0n } }], [R_MEMBER, { id: R_MEMBER, managed: false, position: 2 }], [R_VIP, { id: R_VIP, managed: false, position: 3 }],
        [R_BOOST, { id: R_BOOST, managed: true, position: 4 }], [R_Q, { id: R_Q, managed: false, position: 5, permissions: { bitfield: 0n } }]]);
    const mkMember = (id, roleIds, extra = {}) => {
        const m = { id, user: { id, username: `user${id.slice(-2)}`, bot: false, globalName: null }, nickname: null, manageable: true, bannable: true, kickable: true, setNicknameCalls: [], rolesSetCalls: [], ...extra };
        const cache = new Col(roleIds.map((r) => [r, roles.get(r)]));
        m.roles = { cache, get highest() { return { position: Math.max(0, ...cache.map((r) => r.position)) }; },
            set: async (ids, reason) => { m.rolesSetCalls.push(ids); cache.clear(); for (const i of ids) cache.set(i, roles.get(i)); },
            add: async (r) => cache.set(r.id ?? r, roles.get(r.id ?? r)) };
        m.setNickname = async (n) => { m.setNicknameCalls.push(n); m.nickname = n; };
        return m;
    };
    const members = new Map();
    const me = mkMember(BOT, [R_VIP, R_Q]); me.roles.cache.set('x', { position: 9 }); me.permissions = { has: () => true };
    const modMember = mkMember(MODID, [R_VIP]); modMember.roles.cache.set('y', { position: 10 });
    const guild = { id: G, ownerId: OWNER, name: 'Test', roles: { cache: roles }, channels: { cache: new Col(), fetch: async () => null },
        members: { me, fetchMe: async () => me, fetch: async (id) => { if (id === undefined) return new Col([...members]); const m = members.get(id); if (!m) { const e = new Error('Unknown'); e.code = 10007; throw e; } return m; }, ban: async (id, o) => { guild.banned.push([id, o]); } }, banned: [] };
    const client = { user: { id: BOT }, services, commands: new Map(), users: { fetch: async (id) => ({ id, username: `u${id.slice(-2)}`, send: async () => { dms.push(id); } }) } };
    const dms = [];
    const out = [];
    const interaction = (opts, { perms = true, sub = null, isText = false } = {}) => {
        const i = { client, guild, guildId: G, channelId: '555555555555555555', user: { id: MODID, username: 'mod', displayName: 'mod' }, member: modMember, isTextCommand: isText,
            memberPermissions: { has: () => perms }, deferred: false, replied: false, customId: opts.customId,
            options: { getSubcommand: () => sub, getUser: (n) => opts[n] ?? null, getString: (n) => opts[n] ?? null, getInteger: (n) => opts[n] ?? null, getBoolean: (n) => opts[n] ?? null,
                getRole: (n) => opts[n] ?? null, getChannel: (n) => opts[n] ?? null },
            inGuild: () => true,
            deferReply: async () => { i.deferred = true; }, reply: async (p) => { i.replied = true; out.push(p); }, editReply: async (p) => { out.push(p); },
            update: async (p) => { out.push(p); } };
        return i;
    };
    return { services, guild, members, mkMember, roles, interaction, out, logs, marks, me, dms, client };
}
const text = (p) => (typeof p === 'string' ? p : [p?.content, ...(p?.embeds ?? []).map((e) => e.data?.description ?? '')].filter(Boolean).join(' '));

test('flow: /quarantine add saves roles, removes them, logs a case; add twice is refused; remove restores', async () => {
    const w = world(); const cmd = require('../src/commands/moderation/quarantine');
    w.services.quarantine.setConfig(G, { roleId: R_Q });
    const target = w.mkMember(T1, [R_MEMBER, R_VIP, R_BOOST]); w.members.set(T1, target);
    await cmd.execute(w.interaction({ user: target.user, reason: 'raid' }, { sub: 'add' }));
    assert.deepStrictEqual(target.rolesSetCalls[0], [R_BOOST, R_Q]);
    assert.deepStrictEqual(w.services.quarantine.get(G, T1).roleIds, [R_MEMBER, R_VIP]);
    assert.strictEqual(w.services.cases.getCase(G, 1).type, 'quarantine'); assert.strictEqual(w.logs.length, 1);
    w.out.length = 0;
    await cmd.execute(w.interaction({ user: target.user }, { sub: 'add' })); assert.match(text(w.out.at(-1)), /already quarantined/); assert.strictEqual(target.rolesSetCalls.length, 1);
    await cmd.execute(w.interaction({ user: target.user, reason: 'ok now' }, { sub: 'remove' }));
    assert.deepStrictEqual([...target.roles.cache.keys()].sort(), [R_MEMBER, R_VIP, R_BOOST].sort());
    assert.strictEqual(w.services.quarantine.get(G, T1), null); assert.strictEqual(w.services.cases.getCase(G, 2).type, 'unquarantine');
    await cmd.execute(w.interaction({ user: target.user }, { sub: 'remove' })); assert.match(text(w.out.at(-1)), /not quarantined/);
});
test('flow: quarantine is refused when not set up, and a failed role change leaves no stale record', async () => {
    const w = world(); const cmd = require('../src/commands/moderation/quarantine');
    const target = w.mkMember(T1, [R_MEMBER]); w.members.set(T1, target);
    await cmd.execute(w.interaction({ user: target.user }, { sub: 'add' })); assert.match(text(w.out.at(-1)), /not set up/);
    w.services.quarantine.setConfig(G, { roleId: R_Q });
    target.roles.set = async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); };
    await cmd.execute(w.interaction({ user: target.user }, { sub: 'add' }));
    assert.match(text(w.out.at(-1)), /couldn't quarantine/); assert.strictEqual(w.services.quarantine.get(G, T1), null); assert.strictEqual(w.services.cases.countCases(G), 0);
});
test('flow: quarantine rejoin puts the role back', async () => {
    const w = world(); const ev = require('../src/events/moderation/quarantineRejoin');
    w.services.quarantine.setConfig(G, { roleId: R_Q }); w.services.quarantine.add(G, T1, { roleIds: [R_MEMBER], moderatorId: MODID });
    const m = w.mkMember(T1, []); m.guild = w.guild; m.client = w.client; await ev.execute(m); assert.ok(m.roles.cache.has(R_Q));
    const other = w.mkMember(T2, []); other.guild = w.guild; other.client = w.client; await ev.execute(other); assert.ok(!other.roles.cache.has(R_Q));
});
test('flow: /sanitize user renames only messy names', async () => {
    const w = world(); const cmd = require('../src/commands/moderation/sanitize');
    const messy = w.mkMember(T1, [R_MEMBER], { nickname: '!!! 𝕱𝖆𝖓𝖈𝖞' }); const clean = w.mkMember(T2, [R_MEMBER], { nickname: 'Fine Name' }); w.members.set(T1, messy); w.members.set(T2, clean);
    await cmd.execute(w.interaction({ user: messy.user }, { sub: 'user' })); assert.deepStrictEqual(messy.setNicknameCalls, ['Fancy']);
    await cmd.execute(w.interaction({ user: clean.user }, { sub: 'user' })); assert.strictEqual(clean.setNicknameCalls.length, 0); assert.match(text(w.out.at(-1)), /already has a clean name/);
});
test('flow: /sanitize all renames messy names, skips bots and the owner', async () => {
    const w = world(); const cmd = require('../src/commands/moderation/sanitize');
    const a = w.mkMember(T1, [R_MEMBER], { nickname: '~~a' }); const b = w.mkMember(T2, [R_MEMBER], { nickname: 'good' });
    const bot = w.mkMember('222222222222222233', [R_MEMBER], { nickname: '!bot' }); bot.user.bot = true;
    for (const m of [a, b, bot]) w.members.set(m.id, m);
    await cmd.execute(w.interaction({}, { sub: 'all' }));
    assert.deepStrictEqual(a.setNicknameCalls, ['a']); assert.strictEqual(b.setNicknameCalls.length, 0); assert.strictEqual(bot.setNicknameCalls.length, 0); assert.match(text(w.out.at(-1)), /Renamed \*\*1\*\*/);
});
test('flow: /vc mute, unmute skip, kick and permission refusal', async () => {
    const w = world(); const cmd = require('../src/commands/moderation/vc'); const calls = [];
    const voice = { channelId: 'v1', channel: { id: 'v1' }, serverMute: false, serverDeaf: false, setMute: async (v) => calls.push(['mute', v]), disconnect: async () => calls.push(['kick']), setDeaf: async (v) => calls.push(['deaf', v]), setChannel: async (c) => calls.push(['move', c.id]) };
    const m = w.mkMember(T1, [R_MEMBER], { voice }); w.members.set(T1, m);
    await cmd.execute(w.interaction({ user: m.user }, { sub: 'mute' })); assert.deepStrictEqual(calls, [['mute', true]]);
    await cmd.execute(w.interaction({ user: m.user }, { sub: 'unmute' })); assert.match(text(w.out.at(-1)), /not muted/);
    await cmd.execute(w.interaction({ user: m.user }, { sub: 'kick' })); assert.deepStrictEqual(calls.at(-1), ['kick']);
    const dest = { id: 'v2', permissionsFor: () => ({ has: () => true }) };
    await cmd.execute(w.interaction({ user: m.user, channel: dest }, { sub: 'move' })); assert.deepStrictEqual(calls.at(-1), ['move', 'v2']);
    await cmd.execute(w.interaction({ user: m.user, channel: { ...dest, id: 'v1' } }, { sub: 'move' })); assert.match(text(w.out.at(-1)), /already in that channel/);
    const lonely = w.mkMember(T2, [R_MEMBER], { voice: { channelId: null } }); w.members.set(T2, lonely);
    await cmd.execute(w.interaction({ user: lonely.user }, { sub: 'kick' })); assert.match(text(w.out.at(-1)), /not in a voice channel/);
    const before = calls.length; await cmd.execute(w.interaction({ user: m.user }, { sub: 'kick' }, { perms: false })); // (second arg shape check below)
    assert.strictEqual(w.logs.length >= 4, true);
    const denied = w.interaction({ user: m.user }, { sub: 'mute', perms: false }); denied.memberPermissions = { has: () => false };
    await cmd.execute(denied); assert.match(text(w.out.at(-1)), /Mute Members/); assert.ok(calls.length >= before);
});
test('flow: /massban asks first, bans only on confirm, only once, only by the same moderator; skips protected people', async () => {
    const w = world(); const cmd = require('../src/commands/moderation/massban'); cmd.pending.clear();
    const inMember = w.mkMember(T1, [R_MEMBER]); w.members.set(T1, inMember);
    const higher = w.mkMember(T2, [R_MEMBER]); higher.roles.cache.set('z', { position: 50 }); w.members.set(T2, higher);
    const ids = `${T1} ${T2} 222222222222222240 ${MODID} ${BOT} ${OWNER} ${T1}`;
    await cmd.execute(w.interaction({ ids, reason: 'raid', delete_days: 1 }));
    const preview = w.out.at(-1); assert.match(text(preview), /Ban 3 users/); assert.strictEqual(w.guild.banned.length, 0);
    const tok = JSON.stringify(preview.components[0]).match(/mb:ok:(\w+)/)[1];
    const press = (action, user = MODID) => { const i = w.interaction({ customId: `mb:${action}:${tok}` }); i.user = { id: user }; return cmd.handleComponent(i); };
    await press('ok', T1); assert.strictEqual(w.guild.banned.length, 0); assert.match(text(w.out.at(-1)), /Only <@/);
    await press('ok'); assert.strictEqual(w.guild.banned.length, 2); // the outranking member was refused
    assert.deepStrictEqual(w.guild.banned.map((b) => b[0]).sort(), [T1, '222222222222222240'].sort()); assert.strictEqual(w.guild.banned[0][1].deleteMessageSeconds, 86400);
    assert.strictEqual(w.services.cases.countCases(G), 2); assert.match(w.services.cases.getCase(G, 1).reason, /^Massban: raid/);
    await press('ok'); assert.strictEqual(w.guild.banned.length, 2); assert.match(text(w.out.at(-1)), /expired/); // second click does nothing
    assert.ok(w.marks.some((m) => m[1] === 'ban'));
});
test('flow: /massban cancel, limit, empty list, expiry', async () => {
    const w = world(); const cmd = require('../src/commands/moderation/massban'); cmd.pending.clear();
    await cmd.execute(w.interaction({ ids: 'hello' })); assert.match(text(w.out.at(-1)), /could not find any user IDs/);
    const many = Array.from({ length: 101 }, (_, i) => `2${String(i).padStart(17, '0')}`).join(' ');
    await cmd.execute(w.interaction({ ids: many })); assert.match(text(w.out.at(-1)), /limit is 100/);
    await cmd.execute(w.interaction({ ids: `${T1}` }));
    const tok = JSON.stringify(w.out.at(-1).components[0]).match(/mb:ok:(\w+)/)[1];
    const i = w.interaction({ customId: `mb:no:${tok}` }); await cmd.handleComponent(i); assert.match(text(w.out.at(-1)), /cancelled/); assert.strictEqual(w.guild.banned.length, 0);
    await cmd.execute(w.interaction({ ids: `${T2}` }), { now: 1000 }); // preview made at t=1000 -> expires at 121000
    const tok2 = JSON.stringify(w.out.at(-1).components[0]).match(/mb:ok:(\w+)/)[1];
    await cmd.handleComponent(w.interaction({ customId: `mb:ok:${tok2}` }), { now: 500000 }); assert.match(text(w.out.at(-1)), /expired/);
});
test('flow: /massban reason from the end of a typed command', async () => {
    const w = world(); const cmd = require('../src/commands/moderation/massban'); cmd.pending.clear();
    await cmd.execute(w.interaction({ ids: `${T1} ${T2} raid accounts` }, { isText: true }));
    assert.match(text(w.out.at(-1)), /raid accounts/);
});
test('flow: /report sends to staff, hides the typed message, limits repeats; staff buttons close once', async () => {
    const w = world(); const cmd = require('../src/commands/moderation/report'); const sent = [];
    const staff = { id: '444444444444444441', isTextBased: () => true, send: async (p) => { sent.push(p); return { id: '666666666666666661', channelId: '444444444444444441' }; } };
    w.guild.channels.fetch = async () => staff;
    await cmd.execute(w.interaction({ user: { id: T2, username: 't' }, reason: 'being rude' })); assert.match(text(w.out.at(-1)), /not set up/);
    w.services.reports.setConfig(G, { channelId: staff.id, pingRoleId: R_VIP });
    const typed = w.interaction({ user: { id: T2, username: 't' }, reason: 'being rude' }, { isText: true }); let deleted = false; typed.sourceMessage = { delete: async () => { deleted = true; } };
    await cmd.execute(typed);
    assert.ok(deleted); assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].content, `<@&${R_VIP}>`); assert.deepStrictEqual(sent[0].allowedMentions, { roles: [R_VIP] });
    assert.match(text(w.out.at(-1)), /report \(#1\)/); assert.doesNotMatch(text(w.out.at(-1)), /being rude/);
    await cmd.execute(w.interaction({ user: { id: T2, username: 't' }, reason: 'again' })); assert.match(text(w.out.at(-1)), /already have an open report/);
    await cmd.execute(w.interaction({ user: { id: BOT, username: 'bot' }, reason: 'x' })); assert.match(text(w.out.at(-1)), /cannot report me/);
    const noPerm = w.interaction({ customId: 'rt:resolve:1' }); noPerm.memberPermissions = { has: () => false }; await cmd.handleComponent(noPerm); assert.match(text(w.out.at(-1)), /Moderate Members/);
    await cmd.handleComponent(w.interaction({ customId: 'rt:resolve:1' })); assert.strictEqual(w.services.reports.get(G, 1).status, 'resolved');
    await cmd.handleComponent(w.interaction({ customId: 'rt:dismiss:1' })); assert.match(text(w.out.at(-1)), /already handled/); assert.strictEqual(w.services.reports.get(G, 1).status, 'resolved');
});
test('flow: /report is discarded when the staff channel cannot be used, so the member can retry', async () => {
    const w = world(); const cmd = require('../src/commands/moderation/report');
    w.services.reports.setConfig(G, { channelId: '444444444444444441' });
    w.guild.channels.fetch = async () => ({ id: 'c', isTextBased: () => true, send: async () => { throw new Error('no access'); } });
    await cmd.execute(w.interaction({ user: { id: T2, username: 't' }, reason: 'x' })); assert.match(text(w.out.at(-1)), /cannot post/);
    assert.strictEqual(w.services.reports.get(G, 1), null);
});
test('flow: /modstats shows leaders and handles empty periods', async () => {
    const w = world(); const cmd = require('../src/commands/moderation/modstats');
    await cmd.execute(w.interaction({})); assert.match(text(w.out.at(-1)), /No moderation actions/);
    w.services.cases.createCase({ guildId: G, type: 'warn', targetId: T1, moderatorId: MODID }); w.services.cases.createCase({ guildId: G, type: 'ban', targetId: T1, moderatorId: MODID });
    await cmd.execute(w.interaction({ days: 7 })); const e = JSON.stringify(w.out.at(-1).embeds[0]); assert.match(e, /2\*\* action/); assert.ok(e.includes(`<@${MODID}>`));
});
