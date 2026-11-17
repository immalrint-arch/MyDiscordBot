const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createCustomService, CustomServiceError } = require('../src/services/customService');
const { createTextCommandService } = require('../src/services/textCommandService');
const R = require('../src/custom/rules');
const flow = require('../src/custom/customFlow');
const { handleTextMessage } = require('../src/textcommands/handler');
const { BUILTIN_ALIASES } = require('../src/textcommands/builtinAliases');
const { PermissionFlagsBits } = require('discord.js');

const G = '111111111111111111', CH = '444444444444444441', U = '222222222222222221', BOT = '999999999999999999';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };

test('rules: names, bodies, matching, templates', () => {
    assert.ok(R.NAME_RULE.test('rules') && R.NAME_RULE.test('my_cmd-2')); for (const bad of ['', 'a b', 'A', '!x', 'x'.repeat(33)]) assert.ok(!R.NAME_RULE.test(bad), bad);
    assert.strictEqual(R.cleanBody('  hi\\nthere '), 'hi\nthere'); assert.strictEqual(R.cleanBody('   '), null); assert.strictEqual(R.cleanBody('x'.repeat(R.MAX_RESPONSE + 1)), null);
    assert.ok(R.matches('contains', 'ip', 'what is the IP?')); assert.ok(!R.matches('exact', 'ip', 'what is the ip'));
    assert.ok(R.matches('exact', 'ping', ' Ping ')); assert.ok(R.matches('starts', 'hello', 'Hello world')); assert.ok(!R.matches('starts', 'world', 'hello world'));
    assert.ok(R.matches('word', 'cat', 'a cat sat')); assert.ok(!R.matches('word', 'cat', 'concatenate')); assert.ok(R.matches('word', 'cat', 'cat.'));
    const out = R.render('Hi {username} in {server} #{channel} ({members}) {args} {user}', { userId: U, username: 'Sam', server: 'S', channel: CH, members: 5, args: 'x' });
    assert.match(out, /Hi Sam in S/); assert.match(out, new RegExp(`<@${U}>`)); assert.match(out, /\(5\) x/);
});

test('service: tags create/edit/use/list/remove with limits and duplicates', () => {
    const s = createCustomService(fresh());
    s.tags.create(G, 'Rules', 'be nice', U); assert.strictEqual(s.tags.get(G, 'rules').response, 'be nice');
    assert.throws(() => s.tags.create(G, 'rules', 'again', U), CustomServiceError); assert.throws(() => s.tags.create(G, 'bad name', 'x', U), CustomServiceError); assert.throws(() => s.tags.create(G, 'empty', '  ', U), CustomServiceError);
    s.tags.edit(G, 'rules', 'be kind'); assert.strictEqual(s.tags.get(G, 'rules').response, 'be kind'); assert.throws(() => s.tags.edit(G, 'nope', 'x'), CustomServiceError);
    s.tags.use(G, 'rules'); s.tags.use(G, 'rules'); assert.strictEqual(s.tags.get(G, 'rules').uses, 2);
    assert.strictEqual(s.tags.list(G).length, 1); assert.strictEqual(s.tags.count('333333333333333333'), 0);
    assert.ok(s.tags.remove(G, 'rules')); assert.ok(!s.tags.remove(G, 'rules'));
    for (let i = 0; i < R.MAX_TAGS; i++) s.tags.create(G, `t${i}`, 'x', U); assert.throws(() => s.tags.create(G, 'over', 'x', U), CustomServiceError);
});

test('service: responders match, channel filter, toggle, cooldown, limits', () => {
    let t = 1000; const s = createCustomService(fresh(), { now: () => t });
    const id = s.responders.add(G, { trigger: 'Server IP', response: 'play.example.com', cooldownSeconds: 30, createdBy: U });
    const hit = s.responders.findMatch(G, 'what is the server ip?', CH); assert.strictEqual(hit.id, id);
    assert.ok(s.responders.claim(G, hit)); assert.ok(!s.responders.claim(G, hit)); t += 31000; assert.ok(s.responders.claim(G, hit));
    assert.strictEqual(s.responders.list(G)[0].uses, 2);
    assert.ok(s.responders.setEnabled(G, id, false)); assert.strictEqual(s.responders.findMatch(G, 'server ip', CH), null);
    s.responders.setEnabled(G, id, true); assert.ok(s.responders.findMatch(G, 'server ip', CH));
    const only = s.responders.add(G, { trigger: 'secret', response: 'x', channelId: CH, createdBy: U }); assert.ok(s.responders.findMatch(G, 'secret', CH)); assert.strictEqual(s.responders.findMatch(G, 'secret', '444444444444444442'), null);
    assert.throws(() => s.responders.add(G, { trigger: 'a', response: 'x', createdBy: U }), CustomServiceError); assert.throws(() => s.responders.add(G, { trigger: 'ok', response: 'x', matchType: 'regex', createdBy: U }), CustomServiceError);
    assert.throws(() => s.responders.add(G, { trigger: 'ok', response: 'x', cooldownSeconds: -1, createdBy: U }), CustomServiceError);
    assert.ok(s.responders.remove(G, only)); assert.ok(!s.responders.remove(G, only));
});

// ---- flows with fake Discord objects ----
const fakeInteraction = (client, sub, opts = {}, perms = true) => {
    const out = []; let modal = null;
    return { out, get modal() { return modal; }, client, guild: { id: G, name: 'Srv', memberCount: 7 }, guildId: G, channelId: CH, user: { id: U, username: 'Sam' }, member: { permissions: { has: () => perms } }, memberPermissions: { has: () => perms },
        options: { getSubcommand: () => sub, getString: (k) => opts[k] ?? null, getInteger: (k) => opts[k] ?? null, getBoolean: (k) => opts[k] ?? null, getChannel: () => null },
        inGuild: () => true, replied: false, deferred: false, reply(p) { out.push(p); this.replied = true; return Promise.resolve(); }, followUp(p) { out.push(p); return Promise.resolve(); }, editReply(p) { out.push(p); return Promise.resolve(); },
        showModal(m) { modal = m; return Promise.resolve(); } };
};
const clientWith = (custom, names = ['ban']) => ({ user: { id: BOT }, commands: new Map(names.map((n) => [n, {}])), services: { custom, textCommands: { getConfig: () => ({ enabled: true, prefix: '!' }) } } });

test('flow: /tag create with text, reserved names, use, info, delete, permission', async () => {
    const custom = createCustomService(fresh()); const client = clientWith(custom);
    let i = fakeInteraction(client, 'create', { name: 'rules', response: 'Read {user}' }); await flow.handleTagCommand(i); assert.match(JSON.stringify(i.out), /created/); assert.ok(custom.tags.get(G, 'rules'));
    i = fakeInteraction(client, 'create', { name: 'ban', response: 'x' }); await flow.handleTagCommand(i); assert.match(JSON.stringify(i.out), /built-in/); assert.strictEqual(custom.tags.get(G, 'ban'), null);
    i = fakeInteraction(client, 'create', { name: '8ball', response: 'x' }); await flow.handleTagCommand(i); assert.ok(BUILTIN_ALIASES['8ball']); assert.strictEqual(custom.tags.get(G, '8ball'), null);
    i = fakeInteraction(client, 'use', { name: 'rules' }); await flow.handleTagCommand(i); assert.match(i.out[0].content, new RegExp(`<@${U}>`)); assert.deepStrictEqual(i.out[0].allowedMentions, { parse: [] });
    i = fakeInteraction(client, 'use', { name: 'nope' }); await flow.handleTagCommand(i); assert.match(JSON.stringify(i.out), /no custom command/);
    i = fakeInteraction(client, 'info', { name: 'rules' }); await flow.handleTagCommand(i); assert.match(JSON.stringify(i.out), /used 1 time/);
    i = fakeInteraction(client, 'list'); await flow.handleTagCommand(i); assert.match(JSON.stringify(i.out), /rules/);
    i = fakeInteraction(client, 'delete', { name: 'rules' }, false); await flow.handleTagCommand(i); assert.ok(custom.tags.get(G, 'rules'), 'no permission, not deleted');
    i = fakeInteraction(client, 'delete', { name: 'rules' }); await flow.handleTagCommand(i); assert.strictEqual(custom.tags.get(G, 'rules'), null);
});

test('flow: modal for long text, and the modal submit saves it', async () => {
    const custom = createCustomService(fresh()); const client = clientWith(custom);
    let i = fakeInteraction(client, 'create', { name: 'long' }); await flow.handleTagCommand(i); assert.ok(i.modal); assert.match(JSON.stringify(i.modal), /tg:create:long/);
    const submit = (id, text, perms = true) => { const out = []; return { out, client, customId: id, guild: { id: G }, user: { id: U }, memberPermissions: { has: () => perms }, isModalSubmit: () => true, fields: { getTextInputValue: () => text }, reply: (p) => { out.push(p); return Promise.resolve(); } }; };
    let m = submit('tg:create:long', 'line1\nline2', false); await flow.handleCustomComponent(m); assert.strictEqual(custom.tags.get(G, 'long'), null);
    m = submit('tg:create:long', 'line1\nline2'); await flow.handleCustomComponent(m); assert.strictEqual(custom.tags.get(G, 'long').response, 'line1\nline2');
    m = submit('tg:create:long', 'again'); await flow.handleCustomComponent(m); assert.match(JSON.stringify(m.out), /already exists/);
    m = submit('tg:edit:long', 'new'); await flow.handleCustomComponent(m); assert.strictEqual(custom.tags.get(G, 'long').response, 'new');
    m = submit('tg:create:ban', 'x'); await flow.handleCustomComponent(m); assert.strictEqual(custom.tags.get(G, 'ban'), null);
    i = fakeInteraction(client, 'edit', { name: 'ghost' }); await flow.handleTagCommand(i); assert.ok(!i.modal); assert.match(JSON.stringify(i.out), /no custom command/);
});

test('flow: auto-replies answer once per cooldown, ignore bots, commands and DMs', async () => {
    const custom = createCustomService(fresh()); custom.responders.add(G, { trigger: 'server ip', response: 'IP for {username}', cooldownSeconds: 60, createdBy: U });
    const client = clientWith(custom); const sent = [];
    const msg = (content, extra = {}) => ({ client, guild: { id: G, name: 'Srv', memberCount: 1 }, content, channelId: CH, author: { id: U, username: 'Sam', bot: false }, reply: async (p) => { sent.push(p); }, ...extra });
    await flow.handleResponderMessage(msg('what is the server ip')); assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].content, 'IP for Sam'); assert.deepStrictEqual(sent[0].allowedMentions, { parse: [], repliedUser: false });
    await flow.handleResponderMessage(msg('server ip again')); assert.strictEqual(sent.length, 1, 'cooldown');
    const c2 = createCustomService(fresh()); c2.responders.add(G, { trigger: 'hi there', response: 'x', cooldownSeconds: 0, createdBy: U }); const cl2 = clientWith(c2);
    const run = (extra) => flow.handleResponderMessage({ ...msg('hi there', extra), client: cl2 });
    await run({ author: { id: U, bot: true } }); await run({ guild: null }); await run({ webhookId: '1' }); await run({ system: true }); await run({ content: '!hi there' }); assert.strictEqual(sent.length, 1);
    await run({}); assert.strictEqual(sent.length, 2);
});

test('text commands: !name runs a custom command, built-ins and aliases still win, unknown stays quiet', async () => {
    const db = fresh(); const textCommands = createTextCommandService(db); textCommands.setEnabled(G, true);
    const custom = createCustomService(db); custom.tags.create(G, 'rules', 'Rules for {username}: {args}', U);
    const replies = []; const ran = [];
    const client = { user: { id: BOT }, services: { textCommands, custom }, users: { fetch: async () => null }, commands: new Map([['ping', { data: { name: 'ping', toJSON: () => ({ name: 'ping', options: [] }), options: [] }, execute: async (i) => { ran.push(i.commandName); } }]]) };
    let t = 0; const send = (content) => handleTextMessage({ client, guild: { id: G, name: 'Srv', memberCount: 3, roles: { cache: new Map() }, channels: { cache: new Map() } }, content, author: { id: U, username: 'Sam', bot: false }, member: { id: U, permissions: { has: () => true } }, channelId: CH, createdTimestamp: 1, inGuild: () => true,
        channel: { permissionsFor: () => ({ has: () => true }), sendTyping: async () => {}, send: async (p) => replies.push(p) }, reply: async (p) => { replies.push(p); return { edit: async () => {}, delete: async () => {} }; } }, { now: () => (t += 5000) });
    flow.cooldowns.clear(); assert.ok(await send('!rules be good')); assert.strictEqual(replies[0].content, `Rules for Sam: be good`); assert.deepStrictEqual(replies[0].allowedMentions, { parse: [], repliedUser: false });
    assert.strictEqual(await send('!doesnotexist'), false); assert.strictEqual(replies.length, 1);
    custom.tags.create(G, 'ping', 'custom ping', U); await send('!ping'); assert.deepStrictEqual(ran, ['ping']); assert.ok(!replies.some((r) => r.content === 'custom ping'), 'built-in wins');
});

test('commands: both files load and have the right names', () => {
    const tag = require('../src/commands/custom/tag'); const ar = require('../src/commands/custom/autoresponder');
    assert.strictEqual(tag.data.name, 'tag'); assert.strictEqual(ar.data.name, 'autoresponder'); assert.strictEqual(typeof tag.execute, 'function'); assert.strictEqual(typeof ar.execute, 'function');
});
