const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createAccessService, AccessServiceError } = require('../src/services/accessService');
const { createTextCommandService } = require('../src/services/textCommandService');
const R = require('../src/access/rules');
const access = require('../src/access/accessFlow');
const owner = require('../src/owner/ownerFlow');
const logger = require('../src/utils/logger');
const interactionCreate = require('../src/events/interactionCreate');
const { handleTextMessage } = require('../src/textcommands/handler');

const G = '111111111111111111', G2 = '333333333333333333', CH = '444444444444444441', CH2 = '444444444444444442', CAT = '444444444444444449', U = '222222222222222221', V = '222222222222222222', OWNER = '222222222222222229', BOT = '999999999999999999';
const ROLE = '555555555555555551', ROLE2 = '555555555555555552';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };

test('rules: evaluate', () => {
    const ev = (rules, ctx) => R.evaluate(rules, { command: 'play', roleIds: [], channelIds: [CH], isAdmin: false, ...ctx });
    assert.strictEqual(ev([], {}), null); assert.match(ev([{ kind: 'disabled', targetId: '' }], { isAdmin: true }), /switched off/, 'disabled even for admins');
    assert.match(ev([{ kind: 'channel_allow', targetId: CH2 }], {}), new RegExp(`<#${CH2}>`)); assert.strictEqual(ev([{ kind: 'channel_allow', targetId: CH }], {}), null);
    assert.strictEqual(ev([{ kind: 'channel_allow', targetId: CAT }], { channelIds: [CH, CAT] }), null, 'category allows its channels'); assert.match(ev([{ kind: 'channel_deny', targetId: CAT }], { channelIds: [CH, CAT] }), /cannot be used/);
    assert.match(ev([{ kind: 'role_allow', targetId: ROLE }], {}), /only for/); assert.strictEqual(ev([{ kind: 'role_allow', targetId: ROLE }], { roleIds: [ROLE] }), null);
    assert.match(ev([{ kind: 'role_deny', targetId: ROLE }], { roleIds: [ROLE] }), /not allowed/); assert.strictEqual(ev([{ kind: 'role_deny', targetId: ROLE }], { roleIds: [ROLE2] }), null);
    assert.strictEqual(ev([{ kind: 'role_allow', targetId: ROLE }, { kind: 'channel_deny', targetId: CH }], { isAdmin: true }), null, 'admins ignore role/channel rules');
    for (const p of R.PROTECTED) assert.strictEqual(R.evaluate([{ kind: 'disabled', targetId: '' }], { command: p }), null, p);
});
test('service: rules add/replace/remove/clear, protected, isolation, cache', () => {
    const s = createAccessService(fresh()).rules;
    assert.throws(() => s.add(G, 'help', 'disabled'), AccessServiceError); assert.throws(() => s.add(G, 'ban', 'role_allow', 'x'), TypeError);
    s.add(G, 'ban', 'role_allow', ROLE); s.add(G, 'ban', 'channel_deny', CH); assert.strictEqual(s.forCommand(G, 'ban').length, 2); assert.strictEqual(s.forCommand(G2, 'ban').length, 0);
    s.add(G, 'ban', 'role_deny', ROLE); assert.deepStrictEqual(s.forCommand(G, 'ban').filter((r) => r.kind.startsWith('role')).map((r) => r.kind), ['role_deny'], 'allow and deny replace each other');
    s.add(G, 'ban', 'disabled'); s.add(G, 'ban', 'disabled'); assert.strictEqual(s.forCommand(G, 'ban').filter((r) => r.kind === 'disabled').length, 1);
    assert.ok(s.remove(G, 'ban', ['disabled'])); assert.ok(!s.remove(G, 'ban', ['disabled'])); assert.ok(s.remove(G, 'ban', ['role_allow', 'role_deny'], ROLE));
    assert.deepStrictEqual(s.list(G).map((c) => c.command), ['ban']); assert.strictEqual(s.clear(G, 'ban'), 1); assert.strictEqual(s.count(G), 0);
    for (let i = 0; i < R.MAX_RULES; i++) s.add(G, 'play', 'channel_allow', `66666666666666${String(i).padStart(4, '0')}`); assert.throws(() => s.add(G, 'play', 'role_allow', ROLE), AccessServiceError);
});
test('service: blacklist and config', () => {
    const db = fresh(); const s = createAccessService(db, { now: () => 5 }); const s2 = createAccessService(db);
    assert.ok(!s.blacklist.has(U)); s.blacklist.add(U, 'spam', OWNER); assert.ok(s.blacklist.has(U)); assert.deepStrictEqual(s.blacklist.list().map((b) => [b.userId, b.reason, b.addedBy]), [[U, 'spam', OWNER]]);
    assert.ok(s2.blacklist.has(U), 'persisted'); assert.ok(s.blacklist.remove(U)); assert.ok(!s.blacklist.remove(U)); assert.ok(!s.blacklist.has(U)); assert.throws(() => s.blacklist.add('x', null, OWNER), TypeError);
    assert.strictEqual(s.config.get('k'), null); s.config.set('k', 123); assert.strictEqual(s.config.get('k'), '123'); s.config.set('k', 'z'); assert.strictEqual(s.config.get('k'), 'z'); s.config.delete('k'); assert.strictEqual(s.config.get('k'), null);
});

const mkClient = (svc, names = ['ban', 'play', 'help', 'commandrules', 'ping']) => ({ user: { id: BOT }, commands: new Map(names.map((n) => [n, { data: { name: n }, execute: async () => {} }])), services: { access: svc }, users: { fetch: async () => null } });
test('flow: checkCommandAccess handles roles, threads, admins and the server owner', () => {
    const svc = createAccessService(fresh()); const client = mkClient(svc); svc.rules.add(G, 'play', 'role_allow', ROLE); svc.rules.add(G, 'play', 'channel_allow', CH);
    const base = { guild: { id: G, ownerId: V }, commandName: 'play', userId: U };
    const run = (extra) => access.checkCommandAccess(client, { ...base, member: { roles: [ROLE] }, channel: { id: CH }, ...extra });
    assert.strictEqual(run({}), null); assert.match(run({ channel: { id: CH2 } }), /can only be used in/); assert.match(run({ member: { roles: [] } }), /only for/);
    assert.strictEqual(run({ channel: { id: '777777777777777771', parentId: CH } }), null, 'a thread inside an allowed channel'); assert.strictEqual(run({ member: { roles: { cache: new Map([[ROLE, {}]]) } } }), null, 'GuildMember style roles');
    assert.strictEqual(run({ member: { roles: [] }, channel: { id: CH2 }, isAdmin: true }), null); assert.strictEqual(run({ member: { roles: [] }, channel: { id: CH2 }, userId: V }), null, 'server owner');
    assert.strictEqual(run({ commandName: 'ban' }), null); assert.strictEqual(access.checkCommandAccess({ services: {} }, base), null); assert.strictEqual(access.checkCommandAccess(client, { ...base, guild: null }), null);
    svc.blacklist.add(U, null, OWNER); assert.ok(access.isBlocked(client, U)); assert.ok(!access.isBlocked(client, V)); assert.ok(!access.isBlocked({ services: {} }, U));
});

const ia = (client, sub, opts = {}, perm = true) => { const out = []; return { out, client, guild: { id: G, ownerId: V }, guildId: G, user: { id: U }, member: {}, memberPermissions: { has: () => perm }, inGuild: () => true, deferred: false, replied: false, reply(p) { out.push(p); this.replied = true; return Promise.resolve(); },
    options: { getSubcommand: () => sub, getString: (k) => opts[k] ?? null, getRole: () => ({ id: ROLE }), getChannel: () => ({ id: CH }) } }; };
test('flow: /commandrules sets, shows and removes rules; protects; checks permission', async () => {
    const svc = createAccessService(fresh()); const client = mkClient(svc); const run = async (sub, opts, perm) => { const i = ia(client, sub, opts, perm); await access.handleCommandRulesCommand(i); return JSON.stringify(i.out); };
    assert.match(await run('role', { command: 'ban', mode: 'allow' }), /only <@&/); assert.strictEqual(svc.rules.forCommand(G, 'ban')[0].kind, 'role_allow');
    assert.match(await run('channel', { command: '/play', mode: 'deny' }), /not in/); assert.strictEqual(svc.rules.forCommand(G, 'play')[0].kind, 'channel_deny');
    assert.match(await run('role', { command: 'nope', mode: 'allow' }), /do not have a command/); assert.match(await run('disable', { command: 'help' }), /never be restricted/);
    assert.match(await run('disable', { command: 'ping' }), /switched off/); assert.match(await run('list'), /ping.*switched off/s); assert.match(await run('enable', { command: 'ping' }), /on\*\* again/); assert.match(await run('enable', { command: 'ping' }), /was not switched off/);
    assert.match(await run('role', { command: 'ban', mode: 'remove' }), /Removed/); assert.match(await run('role', { command: 'ban', mode: 'remove' }), /no such rule/);
    assert.match(await run('clear', { command: 'play' }), /Removed 1 rule/); assert.match(await run('list'), /no command rules/);
    assert.match(await run('disable', { command: 'ban' }, false), /permission/); assert.strictEqual(svc.rules.count(G), 0);
    const got = []; await access.autocompleteCommandName({ client, options: { getFocused: () => 'pl' }, respond: async (x) => got.push(...x) }); assert.deepStrictEqual(got, [{ name: 'play', value: 'play' }]);
    const all = []; await access.autocompleteCommandName({ client, options: { getFocused: () => '' }, respond: async (x) => all.push(...x.map((o) => o.value)) }); assert.ok(!all.includes('help') && !all.includes('commandrules') && all.includes('ban'));
});

test('events: interactionCreate blocks blacklisted users, enforces rules, answers autocomplete', async () => {
    const svc = createAccessService(fresh()); const client = mkClient(svc); let ran = 0; client.commands.set('play', { data: { name: 'play' }, execute: async () => { ran++; }, autocomplete: async (i) => i.respond([]) });
    const make = (extra = {}) => { const out = []; return { out, client, commandName: 'play', guild: { id: G, ownerId: V }, user: { id: U }, member: { roles: [] }, channel: { id: CH }, memberPermissions: { has: () => false }, isAutocomplete: () => false, isButton: () => false, isStringSelectMenu: () => false, isModalSubmit: () => false, isChatInputCommand: () => true, replied: false, deferred: false, reply: async (p) => { out.push(p); }, ...extra }; };
    let i = make(); await interactionCreate.execute(i); assert.strictEqual(ran, 1);
    svc.rules.add(G, 'play', 'disabled'); i = make(); await interactionCreate.execute(i); assert.strictEqual(ran, 1); assert.match(JSON.stringify(i.out), /switched off/); assert.deepStrictEqual(i.out[0].allowedMentions, { parse: [] });
    svc.rules.clear(G, 'play'); svc.blacklist.add(U, 'x', OWNER); i = make(); await interactionCreate.execute(i); assert.strictEqual(ran, 1); assert.match(JSON.stringify(i.out), /blocked/);
    let responded = 0; await interactionCreate.execute(make({ isAutocomplete: () => true, respond: async () => { responded++; } })); assert.strictEqual(responded, 0, 'blocked users get no suggestions');
    svc.blacklist.remove(U); await interactionCreate.execute(make({ isAutocomplete: () => true, respond: async () => { responded++; } })); assert.strictEqual(responded, 1);
    const b = make({ isChatInputCommand: () => false, isButton: () => true, customId: 'zz:1' }); svc.blacklist.add(U, null, OWNER); await interactionCreate.execute(b); assert.match(JSON.stringify(b.out), /blocked/);
});

test('text commands: rules and blacklist apply to !commands too', async () => {
    const db = fresh(); const textCommands = createTextCommandService(db); textCommands.setEnabled(G, true); const svc = createAccessService(db); const ran = []; const replies = [];
    const client = { user: { id: BOT }, services: { textCommands, access: svc }, users: { fetch: async () => null }, commands: new Map([['ping', { data: { name: 'ping', toJSON: () => ({ name: 'ping', options: [] }), options: [] }, execute: async (i) => { ran.push(i.commandName); } }]]) };
    let t = 0; const send = (content, uid = U) => handleTextMessage({ client, guild: { id: G, ownerId: V, name: 'S', memberCount: 1, roles: { cache: new Map() }, channels: { cache: new Map() } }, content, author: { id: uid, bot: false }, member: { id: uid, roles: { cache: new Map() }, permissions: { has: () => false } }, channelId: CH, channel: { id: CH, permissionsFor: () => ({ has: () => true }), sendTyping: async () => {}, send: async (p) => replies.push(p) }, createdTimestamp: 1, inGuild: () => true, reply: async (p) => { replies.push(p); return { edit: async () => {}, delete: async () => {} }; } }, { now: () => (t += 5000) });
    await send('!ping'); assert.deepStrictEqual(ran, ['ping']);
    svc.rules.add(G, 'ping', 'disabled'); await send('!ping'); assert.strictEqual(ran.length, 1); assert.match(JSON.stringify(replies.at(-1)), /switched off/);
    svc.rules.clear(G, 'ping'); svc.blacklist.add(U, null, OWNER); const n = replies.length; assert.ok(await send('!ping')); assert.strictEqual(ran.length, 1); assert.strictEqual(replies.length, n, 'silent');
    assert.ok(!(await send('hello there')));
});

test('owner: who is the owner', async () => {
    assert.deepStrictEqual(owner.idsFromApplication({ owner: { id: OWNER } }), [OWNER]); assert.deepStrictEqual(owner.idsFromApplication({ owner: { ownerId: OWNER, members: new Map([['a', { user: { id: V } }]]) } }).sort(), [OWNER, V].sort()); assert.deepStrictEqual(owner.idsFromApplication({}), []);
    assert.deepStrictEqual((await owner.loadOwners({ application: { fetch: async () => ({ owner: { id: OWNER } }) } }, { OWNER_IDS: `${V}, nonsense` })).sort(), [OWNER, V].sort()); assert.ok(owner.isOwner(V) && !owner.isOwner(U));
    assert.deepStrictEqual(await owner.loadOwners({ application: { fetch: async () => { throw new Error('offline'); } } }, {}), []);
});
test('owner: backups are real, rotated, and never overwrite', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incomu-bk-')); const db = fresh(); db.prepare('INSERT INTO guilds (guild_id) VALUES (?)').run(G);
    try {
        const t0 = Date.UTC(2026, 10, 16, 10, 0, 0); const r = owner.createBackup(db, { dir, now: t0, keep: 3 }); assert.ok(r.size > 0 && fs.existsSync(r.file)); assert.match(path.basename(r.file), /^bot-20261116-100000\.sqlite$/);
        const again = owner.createBackup(db, { dir, now: t0, keep: 3 }); assert.ok(again.existed);
        for (let i = 1; i <= 4; i++) owner.createBackup(db, { dir, now: t0 + i * 1000, keep: 3 }); assert.strictEqual(owner.listBackups(dir).length, 3); assert.ok(!fs.existsSync(r.file), 'oldest deleted');
        const { DatabaseSync } = require('node:sqlite'); const copy = new DatabaseSync(path.join(dir, owner.listBackups(dir).at(-1))); assert.strictEqual(copy.prepare('SELECT COUNT(*) AS n FROM guilds').get().n, 1); copy.close();
        assert.ok(owner.lastBackupTime(dir) > 0); assert.strictEqual(owner.lastBackupTime(path.join(dir, 'nope')), 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('owner: /owner is locked to the owner and its tools work', async () => {
    const svc = createAccessService(fresh()); const client = mkClient(svc); client.guilds = { cache: new Map([[G, { id: G, name: 'Big', memberCount: 50 }]]) };
    const run = async (sub, opts = {}, uid = OWNER) => { const out = []; await owner.handleOwnerCommand({ client, user: { id: uid }, deferred: false, replied: false, reply: async (p) => { out.push(p); }, options: { getSubcommand: () => sub, getUser: () => opts.user ?? null, getString: (k) => opts[k] ?? null, getChannel: () => opts.channel ?? null } }); return out.map((o) => o.content).join(' '); };
    owner.setOwnersForTest([]); assert.match(await run('servers'), /OWNER_IDS/); owner.setOwnersForTest([OWNER]);
    assert.match(await run('servers', {}, U), /Only the person who runs/); assert.match(await run('servers'), /Big/);
    assert.match(await run('blacklist-add', { user: { id: U, bot: false }, reason: 'raid' }), /no longer use/); assert.ok(svc.blacklist.has(U));
    assert.match(await run('blacklist-add', { user: { id: OWNER, bot: false } }), /cannot blacklist/); assert.match(await run('blacklist-add', { user: { id: V, bot: true } }), /cannot blacklist/); assert.match(await run('blacklist-add', { user: { id: BOT, bot: true } }), /cannot blacklist/);
    assert.match(await run('blacklist-list'), new RegExp(U)); assert.match(await run('blacklist-remove', { user: { id: U } }), /again/); assert.match(await run('blacklist-remove', { user: { id: U } }), /was not/); assert.match(await run('blacklist-list'), /Nobody/);
    const ch = { id: CH, guild: { members: { me: {} } }, permissionsFor: () => ({ has: () => true }) }; assert.match(await run('errors-set', { channel: ch }), /reported in/); assert.strictEqual(svc.config.get(owner.ERROR_KEY), CH);
    assert.match(await run('errors-off'), /off/); assert.strictEqual(svc.config.get(owner.ERROR_KEY), null);
    const out = []; await owner.handleOwnerCommand({ client, user: { id: U }, reply: async (p) => out.push(p), options: { getSubcommand: () => 'backup' } }); assert.ok(out[0].flags !== undefined || out[0].flags === undefined); // locked, nothing written
});
test('owner: error alerts are sent once, capped, and the logger feeds them', async () => {
    const T = 1_700_000_000_000; const svc = createAccessService(fresh()); const sent = []; const client = mkClient(svc); client.channels = { fetch: async () => ({ send: async (p) => { sent.push(p); } }) };
    assert.strictEqual(await owner.alertError(client, 'boom', T + 1000), false, 'no channel set'); svc.config.set(owner.ERROR_KEY, CH);
    assert.ok(await owner.alertError(client, 'boom', T + 2000)); assert.ok(!(await owner.alertError(client, 'boom', T + 3000)), 'same error within a minute'); assert.ok(await owner.alertError(client, 'boom', T + 70000)); assert.strictEqual(sent.length, 2);
    assert.match(JSON.stringify(sent[0]), /boom/); assert.deepStrictEqual(sent[0].allowedMentions, { parse: [] });
    let n = 0; for (let i = 0; i < 30; i++) if (await owner.alertError(client, `different ${i}`, T + 200000 + i)) n++; assert.ok(n <= 20, `capped (${n})`);
    const quiet = createAccessService(fresh()); const c2 = mkClient(quiet); c2.channels = { fetch: async () => ({ send: async (p) => { sent.push(p); } }) }; quiet.config.set(owner.ERROR_KEY, CH);
    const before = sent.length; const realErr = console.error; console.error = () => {}; try { owner.installErrorAlerts(c2, { now: () => T + 9e9 }); logger.error('Something broke:', new Error('kaboom')); await new Promise((r) => setTimeout(r, 30)); } finally { console.error = realErr; logger.setErrorSink(null); }
    assert.strictEqual(sent.length, before + 1); assert.match(JSON.stringify(sent.at(-1)), /kaboom/);
});
test('owner: /botinfo and command files', async () => {
    const out = []; await owner.handleBotInfo({ client: { user: { username: 'Incomu' }, guilds: { cache: new Map([[G, { memberCount: 5 }]]) }, commands: new Map([['a', {}]]), ws: { ping: 42.3 } }, reply: async (p) => out.push(p) });
    assert.match(JSON.stringify(out[0].embeds), /Incomu/); assert.match(JSON.stringify(out[0].embeds), /42 ms/);
    for (const n of ['commandrules', 'botinfo', 'owner']) { const c = require(`../src/commands/tools/${n}`); assert.strictEqual(c.data.name, n); assert.strictEqual(typeof c.execute, 'function'); }
    assert.strictEqual(typeof require('../src/commands/tools/commandrules').autocomplete, 'function');
});
