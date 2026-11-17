const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createTextCommandService, TextCommandServiceError } = require('../src/services/textCommandService');
const { tokenize, parseArguments, chooseSubcommand, usageLine, T } = require('../src/textcommands/parser');
const { splitInvocation, handleTextMessage } = require('../src/textcommands/handler');
const { createTextInteraction, toMessagePayload } = require('../src/textcommands/adapter');
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const G = '111111111111111111', U = '222222222222222221', BOT = '999999999999999999', MOD = '222222222222222229';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return createTextCommandService(db); };

const banDefs = [
    { name: 'user', type: T.USER, required: true }, { name: 'reason', type: T.STRING }, { name: 'dm', type: T.BOOLEAN },
    { name: 'duration', type: T.STRING }, { name: 'purge_days', type: T.INTEGER, min_value: 0, max_value: 7 },
];

test('tokenizer keeps quoted words together and remembers where tokens start', () => {
    const t = tokenize('a "b c" d');
    assert.deepStrictEqual(t.map((x) => x.text), ['a', 'b c', 'd']);
    assert.strictEqual(t[2].start, 8);
});
test('parser: user, duration, then the rest of the line becomes the reason', () => {
    const r = parseArguments(banDefs, `<@${U}> 7d being rude again`);
    assert.strictEqual(r.error, null);
    assert.strictEqual(r.values.user.value, U); assert.strictEqual(r.values.duration.value, '7d');
    assert.strictEqual(r.values.reason.value, 'being rude again');
});
test('parser: no duration given -> everything is the reason; "no thanks" is not read as a yes/no switch', () => {
    const r = parseArguments(banDefs, `${U} no thanks, spam`);
    assert.strictEqual(r.values.reason.value, 'no thanks, spam'); assert.strictEqual(r.values.dm, undefined);
});
test('parser: missing required value, wrong type, range, usage line', () => {
    assert.match(parseArguments(banDefs, '').error, /user/);
    assert.match(parseArguments(banDefs, 'notauser').error, /member/);
    assert.match(parseArguments([{ name: 'amount', type: T.INTEGER, required: true, min_value: 1, max_value: 100 }], '500').error, /at most 100/);
    assert.match(parseArguments([{ name: 'amount', type: T.INTEGER, required: true }], 'abc').error, /whole number/);
    assert.match(parseArguments([{ name: 'n', type: T.INTEGER, required: true }], '5 extra').error, /did not understand/);
    assert.strictEqual(usageLine('!', ['ban', 'add'], banDefs), '!ban add <user> [reason] [dm] [duration] [purge_days]');
});
test('parser: required reason, choices, files are refused with a helpful message', () => {
    const warn = [{ name: 'user', type: T.USER, required: true }, { name: 'reason', type: T.STRING, required: true }];
    assert.match(parseArguments(warn, U).error, /reason/);
    assert.strictEqual(parseArguments(warn, `${U} "quoted reason"`).values.reason.value, 'quoted reason');
    const ch = [{ name: 'mode', type: T.STRING, required: true, choices: [{ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }] }];
    assert.strictEqual(parseArguments(ch, 'ON').values.mode.value, 'on'); assert.match(parseArguments(ch, 'maybe').error, /one of/);
    assert.match(parseArguments([{ name: 'proof', type: T.ATTACHMENT, required: true }], '').error, /slash/);
});
test('subcommands: word picks it, single subcommand is automatic, otherwise a hint', () => {
    const json = new SlashCommandBuilder().setName('x').setDescription('d')
        .addSubcommand((s) => s.setName('one').setDescription('d')).addSubcommand((s) => s.setName('two').setDescription('d')).toJSON();
    assert.strictEqual(chooseSubcommand(json, 'TWO').subName, 'two');
    assert.match(chooseSubcommand(json, 'nope').error, /Which one/);
    const single = new SlashCommandBuilder().setName('ban').setDescription('d').addSubcommand((s) => s.setName('add').setDescription('d')).toJSON();
    const c = chooseSubcommand(single, '@someone'); assert.strictEqual(c.subName, 'add'); assert.strictEqual(c.consumedSub, false);
});

test('service: defaults, prefix rules, mention prefix, isolation', () => {
    const s = fresh();
    assert.deepStrictEqual(s.getConfig(G), { enabled: false, prefix: '!', mentionPrefix: true });
    s.setEnabled(G, true); s.setPrefix(G, '?'); s.setPrefix(G, 'inc!');
    for (const bad of ['', '/', 'a b', '@', '`', '<x', 'toolong', '**', 5, null]) assert.throws(() => s.setPrefix(G, bad), TextCommandServiceError);
    assert.strictEqual(s.getConfig(G).prefix, 'inc!'); assert.strictEqual(s.getConfig(G).enabled, true);
    assert.strictEqual(s.getConfig('333333333333333333').enabled, false);
    assert.throws(() => s.getConfig('bad'), TypeError);
});
test('service: aliases and blocked commands', () => {
    const s = fresh();
    s.setAlias(G, 'b', 'ban'); assert.strictEqual(s.getAlias(G, 'b'), 'ban');
    s.setAlias(G, 'b', 'Kick'); assert.strictEqual(s.getAlias(G, 'b'), 'kick'); // updated, not duplicated
    assert.strictEqual(s.listAliases(G).length, 1);
    for (const bad of ['', 'Has Space', 'x'.repeat(21), 'a!']) assert.throws(() => s.setAlias(G, bad, 'ban'), TextCommandServiceError);
    assert.throws(() => s.setAlias(G, 'ok', ' '), TextCommandServiceError);
    for (let i = 0; i < 49; i++) s.setAlias(G, `a${i}`, 'ban');
    assert.throws(() => s.setAlias(G, 'overflow', 'ban'), TextCommandServiceError);
    assert.ok(s.removeAlias(G, 'b')); assert.ok(!s.removeAlias(G, 'b'));
    assert.ok(s.disableCommand(G, 'purge')); assert.ok(!s.disableCommand(G, 'purge')); assert.ok(s.isDisabled(G, 'purge'));
    assert.deepStrictEqual(s.listDisabled(G), ['purge']); assert.ok(!s.isDisabled('333333333333333333', 'purge'));
    assert.ok(s.enableCommand(G, 'purge')); assert.ok(!s.enableCommand(G, 'purge'));
});

test('invocation: prefix, @bot prefix, plain chat is ignored', () => {
    const o = { prefix: '!', botId: BOT, mentionPrefix: true };
    assert.deepStrictEqual(splitInvocation('!Ban <@1> spam', o), { commandWord: 'ban', rest: '<@1> spam' });
    assert.deepStrictEqual(splitInvocation(`<@${BOT}> ban x`, o), { commandWord: 'ban', rest: 'x' });
    assert.deepStrictEqual(splitInvocation(`<@!${BOT}>   ping`, o), { commandWord: 'ping', rest: '' });
    assert.strictEqual(splitInvocation('hello !ban', o), null); assert.strictEqual(splitInvocation('!', o), null); assert.strictEqual(splitInvocation('! ban', o), null);
    assert.strictEqual(splitInvocation(`<@${BOT}> ban`, { ...o, mentionPrefix: false }), null);
    assert.strictEqual(splitInvocation('!ban', { ...o, prefix: '?' }), null);
});
test('adapter: strips private flags, never pings, fills empty messages', () => {
    const p = toMessagePayload({ content: 'hi @everyone', flags: 64, ephemeral: true });
    assert.strictEqual(p.flags, undefined); assert.deepStrictEqual(p.allowedMentions, { parse: [], repliedUser: false });
    assert.strictEqual(toMessagePayload('plain').content, 'plain'); assert.ok(toMessagePayload({}).content);
});

// ---------- whole-flow checks with fake Discord objects ----------
let clock = 0; // always moves forward so the one-command-per-second limit never interferes
function world({ perms = [], commands, enable = true, prefix } = {}) {
    const replies = []; const ran = [];
    const svc = fresh(); if (enable) svc.setEnabled(G, true); if (prefix) svc.setPrefix(G, prefix);
    const user = { id: U, tag: 'target' };
    const client = { user: { id: BOT }, services: { textCommands: svc }, users: { fetch: async (id) => (id === U ? user : null) }, commands: new Map() };
    for (const c of commands ?? []) client.commands.set(c.data.name, { data: c.data, execute: async (i) => { ran.push({ name: i.commandName, sub: i.options.getSubcommand(), user: i.options.getUser('user')?.id, reason: i.options.getString('reason'), amount: i.options.getInteger('amount'), duration: i.options.getString('duration') }); if (c.fail) throw new Error('boom'); await i.reply({ content: 'done', flags: 64 }); } });
    const have = new Set(perms);
    const member = { id: MOD, permissions: { has: (b) => have.has(b) } };
    const guild = { id: G, roles: { cache: new Map() }, channels: { cache: new Map() }, members: { fetch: async (id) => (id === U ? { id } : null), me: null }, preferredLocale: 'en-US' };
    const send = (content, author = { id: MOD, bot: false }) => {
        const message = { client, guild, content, author, member, channelId: 'c1', createdTimestamp: 1, inGuild: () => true,
            channel: { permissionsFor: () => member.permissions, sendTyping: async () => {}, send: async (p) => { replies.push(p); return { edit: async () => {} }; } },
            reply: async (p) => { replies.push(p); return { edit: async (x) => replies.push(x), delete: async () => {} }; } };
        return handleTextMessage(message, { now: (() => { clock += 5000; const t = clock; return () => t; })() });
    };
    return { send, replies, ran, svc };
}
const banCmd = { data: new SlashCommandBuilder().setName('ban').setDescription('d').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addSubcommand((s) => s.setName('add').setDescription('d').addUserOption((o) => o.setName('user').setDescription('d').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('d').setMaxLength(100)).addStringOption((o) => o.setName('duration').setDescription('d'))) };
const purgeCmd = { data: new SlashCommandBuilder().setName('purge').setDescription('d').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName('amount').setDescription('d').setRequired(true).setMinValue(1).setMaxValue(100)) };
const pingCmd = { data: new SlashCommandBuilder().setName('ping').setDescription('d'), fail: true };

test('flow: !ban with duration and reason runs the real command with the right values', async () => {
    const w = world({ perms: [PermissionFlagsBits.BanMembers], commands: [banCmd] });
    await w.send(`!ban <@${U}> 7d being rude`);
    assert.deepStrictEqual(w.ran, [{ name: 'ban', sub: 'add', user: U, reason: 'being rude', amount: null, duration: '7d' }]);
    assert.strictEqual(w.replies[0].content, 'done'); assert.strictEqual(w.replies[0].flags, undefined);
    assert.deepStrictEqual(w.replies[0].allowedMentions, { parse: [], repliedUser: false });
});
test('flow: permission gate, off by default, bot messages, unknown words, blocked commands', async () => {
    let w = world({ perms: [], commands: [banCmd] });
    await w.send(`!ban <@${U}> x`); assert.strictEqual(w.ran.length, 0); assert.match(w.replies[0].content, /permission/);
    w = world({ perms: [PermissionFlagsBits.BanMembers], commands: [banCmd], enable: false });
    assert.strictEqual(await w.send(`!ban <@${U}>`), false); assert.strictEqual(w.ran.length, 0); assert.strictEqual(w.replies.length, 0);
    w = world({ perms: [PermissionFlagsBits.BanMembers], commands: [banCmd] });
    await w.send(`!ban <@${U}>`, { id: U, bot: true }); await w.send('!nothing here'); await w.send('just chatting');
    assert.strictEqual(w.ran.length, 0); assert.strictEqual(w.replies.length, 0);
    w.svc.disableCommand(G, 'ban'); await w.send(`!ban <@${U}>`); assert.strictEqual(w.ran.length, 0);
});
test('flow: bad arguments give a usage hint and do not run; alias and custom prefix work', async () => {
    const w = world({ perms: [PermissionFlagsBits.BanMembers, PermissionFlagsBits.ManageMessages], commands: [banCmd, purgeCmd], prefix: '?' });
    await w.send('?purge lots'); assert.strictEqual(w.ran.length, 0); assert.match(w.replies[0].content, /Usage: `\?purge <amount>`/);
    await w.send('!purge 5'); assert.strictEqual(w.ran.length, 0); // old prefix no longer works
    w.svc.setAlias(G, 'clear', 'purge'); w.svc.setAlias(G, 'b', 'ban add');
    await w.send('?clear 25'); assert.strictEqual(w.ran[0].amount, 25);
    await w.send(`?b <@${U}> spamming`); assert.deepStrictEqual([w.ran[1].name, w.ran[1].sub, w.ran[1].reason], ['ban', 'add', 'spamming']);
    await w.send(`<@${BOT}> purge 3`); assert.strictEqual(w.ran[2].amount, 3); // @bot prefix
});
test('flow: unfindable user, command errors, throttle', async () => {
    const w = world({ perms: [PermissionFlagsBits.BanMembers], commands: [banCmd, pingCmd] });
    await w.send('!ban 222222222222222288 x'); assert.strictEqual(w.ran.length, 0); assert.match(w.replies[0].content, /could not find/);
    await w.send('!ping'); assert.match(w.replies.at(-1).content, /went wrong/); // no stack trace shown to users
    const t = createTextInteraction; assert.strictEqual(typeof t, 'function');
});
test('flow: throttle blocks a second command within ~1 second', async () => {
    const w = world({ perms: [PermissionFlagsBits.ManageMessages], commands: [purgeCmd] });
    const msg = (content) => ({ client: { user: { id: BOT }, services: { textCommands: w.svc }, commands: new Map([['purge', { data: purgeCmd.data, execute: async () => { w.ran.push(1); } }]]), users: { fetch: async () => null } },
        guild: { id: G, roles: { cache: new Map() }, channels: { cache: new Map() } }, content, author: { id: '555555555555555555', bot: false }, member: { permissions: { has: () => true } }, channel: { permissionsFor: () => ({ has: () => true }) }, inGuild: () => true, reply: async () => ({}) });
    await handleTextMessage(msg('!purge 1'), { now: () => 100000 }); await handleTextMessage(msg('!purge 2'), { now: () => 100300 }); await handleTextMessage(msg('!purge 3'), { now: () => 101600 });
    assert.strictEqual(w.ran.length, 2);
});
test('parser: when nickname is the rest-of-line, an optional reason does not steal words', () => {
    const defs = [{ name: 'user', type: T.USER, required: true }, { name: 'nickname', type: T.STRING }, { name: 'reason', type: T.STRING }];
    const r = parseArguments(defs, `${U} New Name`);
    assert.strictEqual(r.values.nickname.value, 'New Name'); assert.strictEqual(r.values.reason, undefined);
});
test('parser: a required rest-of-line option first (like massban ids) is not cut short by later numbers', () => {
    const defs = [{ name: 'ids', type: T.STRING, required: true }, { name: 'reason', type: T.STRING }, { name: 'delete_days', type: T.INTEGER, min_value: 0, max_value: 7 }];
    const r = parseArguments(defs, `${U} 222222222222222222 raid`);
    assert.strictEqual(r.error, null); assert.strictEqual(r.values.ids.value, `${U} 222222222222222222 raid`); assert.strictEqual(r.values.delete_days, undefined);
});
