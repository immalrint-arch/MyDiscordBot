const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createModmailService } = require('../src/services/modmailService');
const rules = require('../src/modmail/rules');
const flow = require('../src/modmail/modmailFlow');

const G = '111111111111111111', G2 = '333333333333333333', U = '222222222222222221', U2 = '222222222222222222', STAFF = '555555555555555551', CAT = '666666666666666661', LOG = '777777777777777771', BOT = '999999999999999991', ST = '888888888888888881';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };
let clock = 1_000_000; const svcOf = (db) => createModmailService(db, { now: () => (clock += 1000) });

test('rules: internal notes, channel names, forwarding, transcript', () => {
    assert.ok(rules.isInternal('// careful with this one')); assert.ok(rules.isInternal('  //x')); assert.ok(!rules.isInternal('hello // there')); assert.ok(!rules.isInternal(null));
    assert.strictEqual(rules.channelNameFor('Sam Smith!!'), 'modmail-sam-smith'); assert.strictEqual(rules.channelNameFor('😀😀'), 'modmail-member'); assert.ok(rules.channelNameFor('a'.repeat(80)).length <= 32);
    const f = rules.prepareForward('x'.repeat(5000), Array.from({ length: 8 }, (_, i) => ({ name: `f${i}`, url: 'https://cdn.discordapp.com/a' })));
    assert.ok(f.text.length <= rules.MAX_FORWARD); assert.strictEqual(f.files.length, 5); assert.strictEqual(f.extra, 3);
    assert.ok(rules.hasBody('', [{}])); assert.ok(!rules.hasBody('  ', []));
    const t = rules.formatTranscript({ guildName: 'S', thread: { id: 4, userId: U, openedAt: 0, closedAt: 60000, closeReason: null }, userLabel: 'sam', closedByLabel: 'mod', lines: [{ at: 0, author: 'sam', content: 'hi\nthere', attachments: [{ name: 'a.png', url: 'u' }] }] });
    assert.match(t, /Modmail #4/); assert.match(t, /Reason: No reason provided/); assert.match(t, /📎 a\.png: u/); assert.match(t, /Messages: 1/);
});

test('service: setup, one open per member, close once, isolation, blocks', () => {
    const s = svcOf(fresh());
    assert.throws(() => s.setEnabled(G, true), /setup/); assert.ok(!s.getConfig(G).enabled);
    s.setup(G, { categoryId: CAT, staffRoleId: STAFF, logChannelId: LOG, anonymous: true });
    assert.deepStrictEqual(s.getConfig(G), { enabled: true, categoryId: CAT, staffRoleId: STAFF, logChannelId: LOG, anonymous: true });
    s.setEnabled(G, false); assert.ok(!s.getConfig(G).enabled); s.setEnabled(G, true);
    const id = s.openThread(G, U, '123456789012345671'); assert.ok(s.isThreadChannel('123456789012345671'));
    assert.throws(() => s.openThread(G, U, '123456789012345672'), /already has an open/);
    assert.ok(s.openThread(G2, U, '123456789012345673'), 'other server is independent'); assert.strictEqual(s.openThreadsOfUser(U).length, 2);
    assert.strictEqual(s.byChannel('123456789012345671').id, id); assert.strictEqual(s.openOf(G, U2), null);
    assert.ok(s.close(id, { closedBy: ST, reason: 'done' })); assert.ok(!s.close(id, { closedBy: ST }), 'only once');
    assert.ok(!s.isThreadChannel('123456789012345671')); assert.strictEqual(s.get(id).status, 'closed'); assert.strictEqual(s.get(id).closeReason, 'done');
    assert.ok(s.openThread(G, U, '123456789012345674'), 'can open a new one after closing'); assert.strictEqual(s.countOfUser(G, U), 2); assert.strictEqual(s.countOpen(G), 1);
    s.block(G, U2, 'spam', ST); assert.ok(s.isBlocked(G, U2)); assert.ok(!s.isBlocked(G2, U2)); assert.strictEqual(s.listBlocked(G)[0].reason, 'spam');
    assert.ok(s.unblock(G, U2)); assert.ok(!s.unblock(G, U2)); assert.throws(() => s.block(G, 'x', null, ST), /Invalid/);
});
test('service: open channel cache is rebuilt from the database', () => {
    const db = fresh(); const a = svcOf(db); a.setup(G, { categoryId: CAT, staffRoleId: STAFF, logChannelId: LOG }); a.openThread(G, U, '123456789012345671');
    assert.ok(svcOf(db).isThreadChannel('123456789012345671'));
});

// ---- flow with a fake bot ----
function world({ members = [G], guildsEnabled = [G], blacklisted = false } = {}) {
    const db = fresh(); const modmail = svcOf(db); const sent = { dm: [], channel: [], log: [], deleted: [], created: [] }; let n = 0;
    const users = {}; const mkUser = (id, name = 'sam', dmOk = true) => (users[id] ??= { id, username: name, bot: false, tag: name, createdTimestamp: 0, displayAvatarURL: () => null, send: async (o) => { if (!dmOk) throw new Error('closed'); sent.dm.push({ to: id, ...o }); } });
    const channels = new Map(); const mkChan = (id) => { const c = { id, send: async (o) => { sent.channel.push({ id, ...o }); return {}; }, delete: async () => { sent.deleted.push(id); }, messages: { fetch: async () => new Map() } }; channels.set(id, c); return c; };
    const logCh = { id: LOG, send: async (o) => { sent.log.push(o); } };
    const guilds = new Map(); for (const gid of [G, G2]) {
        if (guildsEnabled.includes(gid)) { modmail.setup(gid, { categoryId: CAT, staffRoleId: STAFF, logChannelId: LOG }); }
        guilds.set(gid, { id: gid, name: `Server ${gid.slice(0, 2)}`,
            channels: { cache: new Map([[CAT, { id: CAT, name: 'Modmail' }], [LOG, logCh]]), create: async (o) => { sent.created.push(o); return mkChan(`12345678901234600${++n}`); }, fetch: async () => logCh },
            members: { cache: new Map(members.includes(gid) ? [[U, { id: U, user: mkUser(U), joinedTimestamp: 0 }]] : []), fetch: async () => { throw new Error('no'); } } });
    }
    const client = { user: { id: BOT }, guilds: { cache: guilds }, channels: { cache: channels, fetch: async (id) => channels.get(id) ?? null }, users: { fetch: async (id) => users[id] ?? mkUser(id) },
        services: { modmail, access: { blacklist: { has: () => blacklisted } }, cases: { countActiveWarnings: () => 2 } } };
    const dm = (content, extra = {}) => { const replies = []; const m = { client, author: mkUser(U), content, attachments: new Map(), guildId: null, reply: async (o) => { replies.push(o); }, react: async (e) => { replies.push({ react: e }); }, ...extra }; m.replies = replies; return m; };
    return { client, modmail, sent, dm, channels, mkUser, users };
}
let T = 10_000_000; const tick = () => (T += 5000);

test('flow: DM from a member of one modmail server opens a private channel and forwards', async () => {
    flow.cooldowns.clear(); const w = world(); const m = w.dm('Hello, I need help');
    await flow.handleDirectMessage(m, { nowMs: tick() });
    assert.strictEqual(w.sent.created.length, 1); const o = w.sent.created[0];
    assert.ok(o.name.startsWith('modmail-')); assert.strictEqual(o.parent, CAT);
    assert.ok(o.permissionOverwrites.some((p) => p.id === G), 'everyone is denied'); assert.ok(o.permissionOverwrites.some((p) => p.id === STAFF));
    assert.strictEqual(w.modmail.openOf(G, U).userId, U); assert.ok(w.sent.channel.length >= 2, 'info card + the message');
    assert.ok(w.sent.channel.every((c) => c.allowedMentions && c.allowedMentions.parse.length === 0)); assert.ok(m.replies.length === 1);
});
test('flow: second DM goes to the same channel (no new channel); fast spam is limited', async () => {
    flow.cooldowns.clear(); const w = world(); await flow.handleDirectMessage(w.dm('one'), { nowMs: tick() });
    const before = w.sent.channel.length; const n = tick() + 5000;
    await flow.handleDirectMessage(w.dm('two'), { nowMs: n }); assert.strictEqual(w.sent.created.length, 1); assert.strictEqual(w.sent.channel.length, before + 1);
    const m = w.dm('three'); await flow.handleDirectMessage(m, { nowMs: n + 100 }); assert.strictEqual(w.sent.channel.length, before + 1, 'too fast'); assert.deepStrictEqual(m.replies, [{ react: '⏳' }]);
});
test('flow: blocked, blacklisted, not a member, modmail off → nothing opens', async () => {
    for (const setup of [() => { const w = world(); w.modmail.block(G, U, null, ST); return w; }, () => world({ blacklisted: true }), () => world({ members: [] }), () => world({ guildsEnabled: [] })]) {
        flow.cooldowns.clear(); const w = setup(); const m = w.dm('hi'); await flow.handleDirectMessage(m, { nowMs: tick() });
        assert.strictEqual(w.sent.created.length, 0); assert.strictEqual(w.modmail.openThreadsOfUser(U).length, 0);
    }
});
test('flow: member of several modmail servers is asked which one; the choice is checked', async () => {
    flow.cooldowns.clear(); const w = world({ members: [G, G2], guildsEnabled: [G, G2] }); const m = w.dm('hello');
    await flow.handleDirectMessage(m, { nowMs: tick() }); assert.strictEqual(w.sent.created.length, 0); assert.strictEqual(flow.pending.size >= 1, true);
    const token = [...flow.pending.keys()].pop();
    const mk = (user, values) => { const r = []; return { r, client: w.client, user, customId: `mm:pick:${token}`, values, update: async (o) => r.push(o), followUp: async (o) => r.push(o), reply: async (o) => r.push(o) }; };
    const other = mk({ id: U2 }, [G]); await flow.handleModmailComponent(other); assert.strictEqual(w.sent.created.length, 0, 'someone else cannot use the menu');
});
test('flow: staff reply is DMed; // notes are not; non-staff ignored; DM failure → ❌', async () => {
    flow.cooldowns.clear(); const w = world(); await flow.handleDirectMessage(w.dm('help'), { nowMs: tick() });
    const t = w.modmail.openOf(G, U); const staffMember = { displayName: 'Mod Mia', permissions: { has: () => false }, roles: { cache: new Map([[STAFF, 1]]) } };
    const msg = (content, member = staffMember) => { const rs = []; return { client: w.client, author: { id: ST, bot: false, username: 'mia', displayAvatarURL: () => null }, member, guild: { name: 'S' }, guildId: G, channelId: t.channelId, content, attachments: new Map(), react: async (e) => rs.push(e), reply: async (o) => rs.push(o), rs }; };
    let a = msg('We can help'); await flow.handleStaffMessage(a); assert.strictEqual(w.sent.dm.length, 1); assert.deepStrictEqual(a.rs, ['✅']);
    flow.cooldowns.clear(); a = msg('// internal only'); await flow.handleStaffMessage(a); assert.strictEqual(w.sent.dm.length, 1, 'not sent'); assert.deepStrictEqual(a.rs, ['📝']);
    a = msg('sneaky', { displayName: 'x', permissions: { has: () => false }, roles: { cache: new Map() } }); await flow.handleStaffMessage(a); assert.strictEqual(w.sent.dm.length, 1);
    w.users[U].send = async () => { throw new Error('closed'); }; flow.cooldowns.clear(); a = msg('again'); await flow.handleStaffMessage(a); assert.strictEqual(a.rs[0], '❌');
    const other = { ...msg('hi'), channelId: '123456789012345699' }; assert.strictEqual(await flow.handleStaffMessage(other), false);
});
test('flow: close happens once, sends transcript, tells member, deletes channel', async () => {
    flow.cooldowns.clear(); const w = world(); await flow.handleDirectMessage(w.dm('help'), { nowMs: tick() }); const t = w.modmail.openOf(G, U);
    const [r1, r2] = await Promise.all([flow.closeConversation(w.client, t, { closedBy: ST, reason: 'Solved' }), flow.closeConversation(w.client, t, { closedBy: ST, reason: 'Solved' })]);
    assert.deepStrictEqual([r1, r2].sort(), [false, true]); assert.strictEqual(w.sent.log.length, 1); assert.deepStrictEqual(w.sent.deleted, [t.channelId]); assert.ok(w.sent.dm.length >= 1); assert.strictEqual(w.modmail.openOf(G, U), null);
});
test('component buttons: staff only, right server', async () => {
    flow.cooldowns.clear(); const w = world(); await flow.handleDirectMessage(w.dm('help'), { nowMs: tick() }); const t = w.modmail.openOf(G, U);
    const click = (id, { member, guildId = G, user = { id: ST } }) => { const r = []; return { r, client: w.client, customId: id, guildId, member, user, reply: async (o) => r.push(o), update: async (o) => r.push(o) }; };
    const nostaff = { permissions: { has: () => false }, roles: { cache: new Map() } }; const staff = { permissions: { has: () => false }, roles: { cache: new Map([[STAFF, 1]]) } };
    let i = click(`mm:close:${t.id}`, { member: nostaff }); await flow.handleModmailComponent(i); assert.match(i.r[0].content, /Only staff/); assert.ok(w.modmail.openOf(G, U));
    i = click(`mm:close:${t.id}`, { member: staff, guildId: G2 }); await flow.handleModmailComponent(i); assert.ok(w.modmail.openOf(G, U), 'wrong server');
    i = click(`mm:uclose:${t.id}`, { member: nostaff, user: { id: U2 } }); await flow.handleModmailComponent(i); assert.ok(w.modmail.openOf(G, U), 'only the member can close from DM');
    i = click(`mm:block:${t.id}`, { member: staff }); await flow.handleModmailComponent(i); await new Promise((r) => setImmediate(r)); assert.ok(w.modmail.isBlocked(G, U)); assert.strictEqual(w.modmail.openOf(G, U), null);
});
test('command file, event, help and guide', () => {
    const c = require('../src/commands/modmail/modmail'); assert.strictEqual(c.data.name, 'modmail');
    assert.strictEqual(require('../src/events/modmail/modmailMessage').name, 'messageCreate');
    const { CATEGORIES } = require('../src/help/catalog'); assert.ok(CATEGORIES.some((x) => x.commands.includes('modmail')));
    const { unknownCommands } = require('../src/utils/commandCheck'); assert.deepStrictEqual(unknownCommands({ commands: new Map([['modmail', 1], ['oldthing', 1]]) }), ['oldthing']);
});

test('menus: every guide fits in a menu of at most 25 (split in rows); /setup topic is autocomplete', () => {
    const { menuRows, menuOptions } = require('../src/setup/setupFlow'); const { GUIDES } = require('../src/setup/guides');
    const opts = menuOptions('overview'); assert.strictEqual(opts.length, GUIDES.length + 3); assert.strictEqual(new Set(opts.map((o) => o.value)).size, opts.length);
    for (const o of opts) assert.ok(o.label.length <= 100 && (!o.description || o.description.length <= 100));
    const rows = menuRows('222222222222222221', 'overview'); assert.strictEqual(rows.length, Math.ceil(opts.length / 25)); assert.ok(rows.length >= 1 && rows.length <= 3, 'rows plus the buttons row must fit in 5');
    const setup = require('../src/commands/admin/setup'); assert.strictEqual(typeof setup.autocomplete, 'function');
});
