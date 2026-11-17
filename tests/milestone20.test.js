const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createGrowthService, GrowthServiceError } = require('../src/services/growthService');
const R = require('../src/growth/rules');
const flow = require('../src/growth/growthFlow');

const G = '111111111111111111', G2 = '333333333333333333', CH = '444444444444444441', A = '222222222222222221', B = '222222222222222222', C = '222222222222222223', D = '222222222222222224', BOT = '999999999999999999';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };
const DAY = 86400000;

test('rules: detectInvite', () => {
    const before = new Map([['aaa', { uses: 1, maxUses: 0, inviterId: A }], ['bbb', { uses: 4, maxUses: 5, inviterId: B }]]);
    assert.deepStrictEqual(R.detectInvite(before, [{ code: 'aaa', uses: 2, maxUses: 0, inviterId: A }, { code: 'bbb', uses: 4, maxUses: 5, inviterId: B }]), { code: 'aaa', inviterId: A });
    assert.deepStrictEqual(R.detectInvite(before, [{ code: 'aaa', uses: 1, maxUses: 0, inviterId: A }]), { code: 'bbb', inviterId: B }, 'used-up invite vanished');
    assert.strictEqual(R.detectInvite(before, [{ code: 'aaa', uses: 2, inviterId: A }, { code: 'bbb', uses: 5, inviterId: B }]), null, 'two at once');
    assert.strictEqual(R.detectInvite(before, [{ code: 'aaa', uses: 1, inviterId: A }, { code: 'bbb', uses: 4, inviterId: B }]), null, 'nothing changed (vanity)');
    assert.deepStrictEqual(R.detectInvite(new Map(), [{ code: 'new', uses: 1, maxUses: 0, inviterId: C }]), { code: 'new', inviterId: C }, 'created and used between checks');
    assert.strictEqual(R.detectInvite(new Map(), [{ code: 'new', uses: 0, inviterId: C }]), null);
});
test('rules: fake accounts, templates, dangerous roles', () => {
    assert.ok(R.isFakeAccount(1000, 1000 + 6 * DAY)); assert.ok(!R.isFakeAccount(1000, 1000 + 8 * DAY));
    assert.strictEqual(R.validTemplate('Members: {members}').template, 'Members: {members}'); for (const bad of ['', 'no number', '{nope}', 'x{members}'.repeat(30)]) assert.ok(R.validTemplate(bad).problem, bad);
    assert.strictEqual(R.renderTemplate('Members: {members}', { members: 1234 }), 'Members: 1,234'); assert.strictEqual(R.renderTemplate('Bots: {bots}', { bots: undefined }), null); assert.strictEqual(R.renderTemplate('{members}/{roles}', { members: 5, roles: 0 }), '5/0');
    const flags = { Administrator: 1n, ManageRoles: 2n, ChangeNickname: 4n }; const role = (bits) => ({ permissions: { has: (f) => (bits & f) === f } });
    assert.ok(R.isDangerousRole(role(1n), flags)); assert.ok(R.isDangerousRole(role(2n), flags)); assert.ok(!R.isDangerousRole(role(4n), flags)); assert.ok(!R.isDangerousRole(role(0n), flags));
});

test('service: invites count, rejoin once, leave, fake, self-invite, isolation', () => {
    let t = 1000; const s = createGrowthService(fresh(), { now: () => t }).invites;
    assert.ok(!s.isEnabled(G)); s.setEnabled(G, true); assert.ok(s.isEnabled(G)); assert.ok(!s.isEnabled(G2));
    s.recordJoin(G, B, { inviterId: A, code: 'x' }); s.recordJoin(G, C, { inviterId: A, code: 'x', fake: true }); s.recordJoin(G, D, { inviterId: A, code: 'x' });
    assert.deepStrictEqual(s.stats(G, A), { joins: 3, left: 0, fake: 1, net: 2 });
    t = 2000; s.recordLeave(G, D); assert.deepStrictEqual(s.stats(G, A), { joins: 3, left: 1, fake: 1, net: 1 });
    s.recordJoin(G, D, { inviterId: A, code: 'x' }); assert.deepStrictEqual(s.stats(G, A), { joins: 3, left: 0, fake: 1, net: 2 }, 'rejoin counted once'); assert.strictEqual(s.inviterOf(G, D).joins, 2);
    s.recordJoin(G, D, { inviterId: B, code: 'y' }); assert.strictEqual(s.stats(G, A).joins, 2); assert.strictEqual(s.stats(G, B).joins, 1, 'newest inviter wins');
    s.recordJoin(G, A, { inviterId: A }); assert.strictEqual(s.inviterOf(G, A).inviterId, null, 'cannot invite yourself');
    assert.deepStrictEqual(s.top(G, 5).map((r) => [r.inviterId, r.net]), [[A, 1], [B, 1]].sort(() => 0).map(([a, n]) => [a, n]).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)));
    assert.strictEqual(s.top(G2).length, 0); assert.strictEqual(s.stats(G2, A).joins, 0);
    assert.strictEqual(s.reset(G), 4); assert.strictEqual(s.total(G), 0);
});
test('service: sticky roles save/take/expire/forget', () => {
    let t = 1000; const s = createGrowthService(fresh(), { now: () => t }).stickyRoles; const R1 = '555555555555555551', R2 = '555555555555555552';
    s.save(G, A, [R1, R2]); assert.strictEqual(s.count(G), 1); assert.deepStrictEqual(s.take(G, A), [R1, R2]); assert.strictEqual(s.take(G, A), null, 'only once');
    s.save(G, A, [R1]); s.save(G, A, []); assert.strictEqual(s.take(G, A), null, 'empty save clears');
    s.save(G, B, [R1]); t += R.SAVED_ROLES_MAX_AGE_MS + 1; assert.strictEqual(s.take(G, B), null, 'expired');
    s.save(G, C, [R1]); t += 1; assert.ok(s.forget(G, C)); assert.ok(!s.forget(G, C));
    s.save(G, D, [R1]); t += R.SAVED_ROLES_MAX_AGE_MS + 1; assert.strictEqual(s.purgeOld(), 1);
});
test('service: counters add/replace/limit/validate', () => {
    const s = createGrowthService(fresh()).counters;
    assert.throws(() => s.add(G, { channelId: CH, template: 'no number' }), GrowthServiceError);
    const c = s.add(G, { channelId: CH, template: 'Members: {members}' }); assert.strictEqual(c.template, 'Members: {members}');
    s.markUpdated(c.id, 'Members: 5', 99); assert.strictEqual(s.list(G)[0].lastName, 'Members: 5'); const again = s.add(G, { channelId: CH, template: 'People: {humans}' }); assert.strictEqual(again.lastUpdate, 0); assert.strictEqual(s.list(G).length, 1);
    for (let i = 1; i < R.MAX_COUNTERS; i++) s.add(G, { channelId: `44444444444444${String(i).padStart(4, '0')}`, template: '{members}' }); assert.throws(() => s.add(G, { channelId: '444444444444449999', template: '{members}' }), GrowthServiceError);
    assert.ok(s.remove(G, CH)); assert.ok(!s.remove(G, CH)); assert.strictEqual(s.all().length, R.MAX_COUNTERS - 1);
});

// ---- flows with fake Discord objects ----
class Coll extends Map { filter(fn) { const o = new Coll(); for (const [k, v] of this) if (fn(v, k)) o.set(k, v); return o; } }
const inv = (code, uses, inviter, maxUses = 0) => ({ code, uses, maxUses, inviter: inviter ? { id: inviter } : null });
function world({ invites = [], canSeeInvites = true, memberCount = 10, enabled = true } = {}) {
    const db = fresh(); const growth = createGrowthService(db); if (enabled) growth.invites.setEnabled(G, true);
    const logs = []; let list = invites; const responses = []; const state = { names: [] };
    const guild = { id: G, name: 'Srv', memberCount, premiumSubscriptionCount: 2, premiumTier: 1, invites: { fetch: async () => { if (!canSeeInvites) throw new Error('Missing Permissions'); const use = responses.length ? responses.shift() : list; return new Map(use.map((i) => [i.code, i])); } },
        members: { cache: new Coll(), me: { bot: true } }, roles: { cache: new Coll() }, channels: { cache: new Coll() } };
    const channel = { id: CH, guildId: G, name: 'old', setName: async (n) => { if (state.fail) throw new Error('Missing Permissions'); channel.name = n; state.names.push(n); }, permissionsFor: () => ({ has: () => true }) };
    const client = { user: { id: BOT }, guilds: { cache: new Map([[G, guild]]) }, channels: { fetch: async (id) => { if (state.gone) { const e = new Error('Unknown Channel'); e.code = 10003; throw e; } return id === CH ? channel : null; } }, services: { growth, logs: { send: async (g, cat, p) => { logs.push({ cat, p }); } }, quarantine: { get: () => null } } };
    return { db, growth, guild, client, logs, channel, state, responses, setInvites: (l) => { list = l; } };
}
const member = (w, id, { bot = false, age = 100 * DAY, roles = [] } = {}) => ({ id, client: w.client, guild: w.guild, user: { id, bot, createdTimestamp: Date.now() - age }, roles: { cache: new Coll(roles.map((r) => [r.id, r])), add: async (ids, why) => { (member.added ??= []).push({ id, ids, why }); } } });

test('flow: invite tracker finds the inviter, handles unknowns, bots, disabled, no permission', async () => {
    const w = world({ invites: [inv('aaa', 0, A), inv('bbb', 3, B)] }); await flow.refreshInviteCache(w.guild);
    w.setInvites([inv('aaa', 1, A), inv('bbb', 3, B)]); await flow.handleInviteJoin(member(w, C));
    assert.deepStrictEqual(w.growth.invites.inviterOf(G, C).inviterId, A); assert.match(JSON.stringify(w.logs[0].p), /aaa/); assert.strictEqual(w.logs[0].cat, 'members');
    w.setInvites([inv('aaa', 1, A), inv('bbb', 4, B)]); await flow.handleInviteJoin(member(w, D, { age: 2 * DAY })); assert.strictEqual(w.growth.invites.inviterOf(G, D).inviterId, B); assert.deepStrictEqual(w.growth.invites.stats(G, B), { joins: 1, left: 0, fake: 1, net: 0 });
    await flow.handleInviteJoin(member(w, '222222222222222229')); assert.strictEqual(w.growth.invites.inviterOf(G, '222222222222222229').inviterId, null); assert.match(JSON.stringify(w.logs.at(-1).p), /could not tell/);
    const n = w.growth.invites.total(G); await flow.handleInviteJoin(member(w, '222222222222222228', { bot: true })); assert.strictEqual(w.growth.invites.total(G), n);
    const off = world({ enabled: false }); await flow.handleInviteJoin(member(off, C)); assert.strictEqual(off.growth.invites.total(G), 0);
    const blind = world({ canSeeInvites: false }); await flow.handleInviteJoin(member(blind, C)); assert.match(JSON.stringify(blind.logs[0].p), /Manage Server/);
    flow.handleInviteLeave(member(w, C)); assert.ok(w.growth.invites.inviterOf(G, C).leftAt);
});
test('flow: two joins at once are handled one after the other', async () => {
    const w = world({ invites: [inv('aaa', 0, A), inv('bbb', 0, B)] }); await flow.refreshInviteCache(w.guild);
    w.responses.push([inv('aaa', 1, A), inv('bbb', 0, B)], [inv('aaa', 1, A), inv('bbb', 1, B)]); // what Discord returns for the first and the second join
    const first = flow.handleInviteJoin(member(w, C)); const second = flow.handleInviteJoin(member(w, D)); await Promise.all([first, second]);
    assert.strictEqual(w.growth.invites.inviterOf(G, C).inviterId, A); assert.strictEqual(w.growth.invites.inviterOf(G, D).inviterId, B);
});
test('flow: sticky roles save on leave and give back on rejoin, safely', async () => {
    const w = world(); w.growth.stickyRoles.setEnabled(G, true);
    const r = (id, extra = {}) => ({ id, managed: false, editable: true, permissions: { has: () => false }, ...extra }); const r1 = r('555555555555555551'), r2 = r('555555555555555552'), bot = r('555555555555555553', { managed: true }), everyone = r(G);
    for (const x of [r1, r2]) w.guild.roles.cache.set(x.id, x); w.guild.roles.cache.set(bot.id, bot);
    await flow.saveStickyRoles(member(w, A, { roles: [r1, r2, bot, everyone] })); assert.strictEqual(w.growth.stickyRoles.count(G), 1);
    r2.editable = false; member.added = []; await flow.restoreStickyRoles(member(w, A)); assert.deepStrictEqual(member.added[0].ids, [r1.id], 'only roles I can give'); assert.match(JSON.stringify(w.logs.at(-1).p), /Restored 1 role/);
    await flow.restoreStickyRoles(member(w, A)); assert.strictEqual(member.added.length, 1, 'only once');
    w.growth.stickyRoles.save(G, B, [r1.id]); w.client.services.quarantine.get = () => ({}); await flow.restoreStickyRoles(member(w, B)); assert.strictEqual(member.added.length, 1, 'quarantined get nothing'); w.client.services.quarantine.get = () => null;
    w.growth.stickyRoles.setEnabled(G, false); w.growth.stickyRoles.save(G, C, [r1.id]); await flow.restoreStickyRoles(member(w, C)); assert.strictEqual(member.added.length, 1, 'off = nothing');
    await flow.saveStickyRoles(member(w, D, { roles: [r1], bot: true })); const wOff = w.growth.stickyRoles.count(G); assert.ok(wOff >= 1);
    const bots = member(w, D); bots.user.bot = true; w.growth.stickyRoles.setEnabled(G, true); await flow.saveStickyRoles(bots); assert.strictEqual(w.growth.stickyRoles.count(G), wOff);
});
test('flow: counters rename when due, respect the 10 minute gap, and handle unknown numbers and deleted channels', async () => {
    const w = world({ memberCount: 1234 }); const row = w.growth.counters.add(G, { channelId: CH, template: 'Members: {members}' }); const T = 1_000_000_000_000;
    assert.strictEqual(await flow.updateCounter(w.client, row, T), 'updated'); assert.strictEqual(w.channel.name, 'Members: 1,234');
    let r2 = w.growth.counters.list(G)[0]; assert.strictEqual(await flow.updateCounter(w.client, r2, T + 1000), 'same');
    w.guild.memberCount = 1300; assert.strictEqual(await flow.updateCounter(w.client, r2, T + 60000), 'wait'); assert.strictEqual(await flow.updateCounter(w.client, r2, T + 11 * 60000), 'updated'); assert.strictEqual(w.channel.name, 'Members: 1,300');
    r2 = w.growth.counters.list(G)[0]; w.guild.memberCount = 1400; assert.strictEqual(await flow.updateCounter(w.client, r2, T + 11 * 60000 + 5, { force: true }), 'updated');
    const hum = w.growth.counters.add(G, { channelId: '444444444444444442', template: 'Humans: {humans}' }); assert.strictEqual(await flow.updateCounter(w.client, hum, T), 'unknown', 'member list incomplete');
    assert.strictEqual(flow.counterStats(w.guild).humans, undefined);
    w.state.fail = true; w.guild.memberCount = 5; const r3 = w.growth.counters.list(G)[0]; assert.strictEqual(await flow.updateCounter(w.client, r3, T + 99 * 60000), 'failed');
    w.state.fail = false; w.state.gone = true; const r4 = w.growth.counters.list(G)[0]; assert.strictEqual(await flow.updateCounter(w.client, { ...r4, lastUpdate: 0, lastName: null }, T + 200 * 60000), 'gone'); assert.ok(!w.growth.counters.list(G).some((c) => c.id === r4.id));
    const w2 = world({ memberCount: 3 }); for (let i = 0; i < 3; i++) w2.guild.members.cache.set(`2222222222222222${i}0`, { user: { bot: i === 0 } }); assert.deepStrictEqual([flow.counterStats(w2.guild).humans, flow.counterStats(w2.guild).bots], [2, 1]);
});
const fakeInteraction = (w, sub, opts = {}, perm = true) => { const out = []; return { out, client: w.client, guild: w.guild, guildId: G, user: { id: A }, member: {}, memberPermissions: { has: () => perm }, inGuild: () => true, deferred: false, replied: false, reply(p) { out.push(p); return Promise.resolve(); },
    options: { getSubcommand: () => sub, getUser: (k) => (opts.user ? { id: opts.user } : null), getBoolean: (k) => opts[k] ?? null, getString: (k) => opts[k] ?? null, getChannel: () => w.channel } }; };
test('commands: /invites, /stickyroles, /membercount behave and check permissions', async () => {
    const w = world({ enabled: false, invites: [inv('aaa', 0, A)] }); const run = async (fn, sub, opts, perm) => { const i = fakeInteraction(w, sub, opts, perm); await fn(i); return JSON.stringify(i.out); };
    assert.match(await run(flow.handleInvitesCommand, 'stats'), /turn it on/); assert.match(await run(flow.handleInvitesCommand, 'enable', {}, false), /permission/); assert.ok(!w.growth.invites.isEnabled(G));
    assert.match(await run(flow.handleInvitesCommand, 'enable'), /on/); assert.ok(w.growth.invites.isEnabled(G));
    w.growth.invites.recordJoin(G, B, { inviterId: A, code: 'aaa' }); assert.match(await run(flow.handleInvitesCommand, 'stats'), /\*\*1\*\* invites/); assert.match(await run(flow.handleInvitesCommand, 'top'), /Top inviters/);
    assert.match(await run(flow.handleInvitesCommand, 'who', { user: B }), /with an invite from/); assert.match(await run(flow.handleInvitesCommand, 'who', { user: B }, false), /permission/);
    assert.match(await run(flow.handleInvitesCommand, 'reset', { confirm: false }), /Nothing was deleted/); assert.strictEqual(w.growth.invites.total(G), 1); assert.match(await run(flow.handleInvitesCommand, 'reset', { confirm: true }), /1 member/); assert.strictEqual(w.growth.invites.total(G), 0);
    assert.match(await run(flow.handleInvitesCommand, 'disable'), /off/); assert.ok(!w.growth.invites.isEnabled(G));
    assert.match(await run(flow.handleStickyRolesCommand, 'enable'), /on/); assert.ok(w.growth.stickyRoles.isEnabled(G)); assert.match(await run(flow.handleStickyRolesCommand, 'status'), /on/); assert.match(await run(flow.handleStickyRolesCommand, 'enable', {}, false), /permission/);
    w.growth.stickyRoles.save(G, B, ['555555555555555551']); assert.match(await run(flow.handleStickyRolesCommand, 'forget', { user: B }), /Forgot/); assert.match(await run(flow.handleStickyRolesCommand, 'disable'), /off/);
    assert.match(await run(flow.handleMemberCountCommand, 'add', { text: 'nope' }), /at least one/); assert.match(await run(flow.handleMemberCountCommand, 'add', { text: 'Members: {members}' }, false), /permission/);
    assert.match(await run(flow.handleMemberCountCommand, 'add', { text: 'Members: {members}' }), /live counter/); assert.strictEqual(w.channel.name, 'Members: 10'); assert.match(await run(flow.handleMemberCountCommand, 'list'), /Members/);
    assert.match(await run(flow.handleMemberCountCommand, 'remove'), /no longer/); assert.match(await run(flow.handleMemberCountCommand, 'remove'), /not a counter/);
});
test('command files load with the right names', () => {
    for (const n of ['invites', 'stickyroles', 'membercount']) { const c = require(`../src/commands/growth/${n}`); assert.strictEqual(c.data.name, n); assert.strictEqual(typeof c.execute, 'function'); }
});
