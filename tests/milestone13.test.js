const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createConfessionService, ConfessionServiceError } = require('../src/services/confessionService');
const rules = require('../src/confessions/confessionRules');
const flow = require('../src/confessions/confessionFlow');
const { PermissionFlagsBits, MessageFlags } = require('discord.js');

const G = '111111111111111111', U1 = '222222222222222221', U2 = '222222222222222222', MOD = '222222222222222229', CH = '444444444444444441', OTHER = '444444444444444442';
let clock = Date.parse('2026-11-12T00:00:00Z');
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return { db, svc: createConfessionService(db, { now: () => clock }) }; };

test('rules: cleaning, limits, invites, mentions, invisible tricks', () => {
    assert.deepStrictEqual(rules.cleanConfession('  hello  '), { ok: true, text: 'hello' });
    assert.strictEqual(rules.cleanConfession('   ').ok, false); assert.strictEqual(rules.cleanConfession(null).ok, false);
    assert.strictEqual(rules.cleanConfession('x'.repeat(1801)).ok, false); assert.strictEqual(rules.cleanConfession('x'.repeat(1800)).ok, true);
    assert.match(rules.cleanConfession('join discord.gg/abc123').problem, /invite/); assert.strictEqual(rules.cleanConfession('discord.com/invite/zzz').ok, false);
    assert.ok(!/@everyone/.test(rules.cleanConfession('hi @everyone and @here').text)); // can never ping
    assert.strictEqual(rules.cleanConfession('a\n\n\n\n\nb').text, 'a\n\nb');
    assert.strictEqual(rules.cleanConfession('a‮b').text, 'ab');
    assert.strictEqual(rules.pickColor(() => 0), rules.COLORS[0]); assert.strictEqual(rules.pickColor(() => 0.999999), rules.COLORS.at(-1));
    assert.strictEqual(rules.cooldownLeft(null, 60, 1), 0); assert.strictEqual(rules.cooldownLeft('2026-11-12T00:00:00.000Z', 60, Date.parse('2026-11-12T00:00:20Z')), 40);
});

test('service: numbering per server, cooldown, failed posts do not cost the cooldown, config', () => {
    const { svc } = fresh();
    assert.deepStrictEqual(svc.getConfig(G), { channelId: null, cooldownSeconds: 60 });
    svc.setChannel(G, CH); svc.setCooldown(G, 30); assert.deepStrictEqual(svc.getConfig(G), { channelId: CH, cooldownSeconds: 30 });
    assert.throws(() => svc.setCooldown(G, 5), ConfessionServiceError); assert.throws(() => svc.setChannel(G, 'bad'), TypeError);
    const a = svc.create(G, U1, 'first'); assert.strictEqual(a.number, 1); assert.ok(!('authorId' in a) && !('author_id' in a)); // author never leaves the service
    assert.throws(() => svc.create(G, U1, 'too soon'), /wait 30 more seconds/);
    assert.strictEqual(svc.create(G, U2, 'someone else').number, 2);
    clock += 31000; svc.attachMessage(G, 1, CH, '555555555555555551'); assert.strictEqual(svc.create(G, U1, 'later').number, 3);
    svc.discard(G, 3); clock += 0; assert.doesNotThrow(() => svc.create(G, U1, 'retry after failed post')); // number 3 was freed and no cooldown was used
    assert.throws(() => svc.create(G, U1, 'x'.repeat(2000)), ConfessionServiceError);
    assert.strictEqual(svc.create('333333333333333300', U1, 'other server').number, 1);
});

test('service: block by number hides the author, blocks future confessions, unblock, delete state', () => {
    const { svc } = fresh(); clock += 1e6;
    svc.create(G, U1, 'abuse'); svc.attachMessage(G, 1, CH, '555555555555555551');
    assert.strictEqual(svc.blockAuthorOf(G, 99), 'missing'); assert.strictEqual(svc.blockAuthorOf(G, 1), 'blocked'); assert.strictEqual(svc.blockAuthorOf(G, 1), 'already');
    clock += 1e6; assert.throws(() => svc.create(G, U1, 'again'), /not allowed/); assert.strictEqual(svc.create(G, U2, 'fine').number, 2);
    assert.deepStrictEqual(svc.listBlockedNumbers(G), [1]);
    assert.ok(svc.unblockByNumber(G, 1)); assert.ok(!svc.unblockByNumber(G, 1)); assert.doesNotThrow(() => svc.create(G, U1, 'back'));
    assert.ok(svc.markDeleted(G, 1)); assert.ok(!svc.markDeleted(G, 1)); assert.strictEqual(svc.get(G, 1).deleted, true);
});

// ---------- flows with fake Discord objects ----------
function world({ config = true, mod = false } = {}) {
    const { svc } = fresh(); clock += 1e7;
    if (config) svc.setChannel(G, CH);
    const posted = []; const out = []; const modals = [];
    const channel = { id: CH, isTextBased: () => true, send: async (p) => { posted.push(p); return { id: `66666666666666${String(posted.length).padStart(4, '0')}` }; } };
    const guild = { id: G, channels: { fetch: async () => channel } };
    const client = { services: { confessions: svc } };
    const mk = (extra = {}) => { const i = { client, guild, guildId: G, channelId: CH, user: { id: U1 }, memberPermissions: { has: (b) => mod && b === PermissionFlagsBits.ManageMessages },
        deferReply: async () => { i.deferred = true; }, reply: async (p) => out.push(p), editReply: async (p) => out.push(p), showModal: async (m) => modals.push(m),
        isModalSubmit: () => false, inGuild: () => true, customId: 'cf:new', ...extra }; return i; };
    return { svc, posted, out, modals, mk, channel, client };
}
const txt = (p) => (typeof p === 'string' ? p : p?.content ?? '');

test('flow: a confession is posted by the bot as an embed with a Confess button; the member gets a PRIVATE confirmation', async () => {
    const w = world(); const i = w.mk();
    await flow.submitConfession(i, 'I am the god of 67', { rng: () => 0 });
    assert.strictEqual(w.posted.length, 1); const json = JSON.stringify(w.posted[0]);
    assert.ok(json.includes('Anonymous Confession (#1)')); assert.ok(json.includes('\\"I am the god of 67\\"')); assert.ok(json.includes('cf:new')); assert.ok(!json.includes(U1));
    assert.deepStrictEqual(w.posted[0].allowedMentions, { parse: [] });
    assert.match(txt(w.out.at(-1)), /posted anonymously as \*\*#1\*\*/);
    assert.strictEqual(w.svc.get(G, 1).messageId !== null, true);
    assert.ok(i.deferred);
});
test('flow: wrong channel is refused for members (privately), allowed for moderators; off when not set up', async () => {
    let w = world(); await flow.submitConfession(w.mk({ channelId: OTHER }), 'hello there');
    assert.strictEqual(w.posted.length, 0); assert.match(txt(w.out.at(-1)), new RegExp(`only be sent in <#${CH}>`)); assert.strictEqual(w.out.at(-1).flags, MessageFlags.Ephemeral);
    w = world({ mod: true }); await flow.submitConfession(w.mk({ channelId: OTHER }), 'mod post'); assert.strictEqual(w.posted.length, 1);
    w = world({ config: false }); await flow.submitConfession(w.mk(), 'x y z'); assert.match(txt(w.out.at(-1)), /not set up/); assert.strictEqual(w.posted.length, 0);
});
test('flow: cooldown, blocked and bad text give private messages and post nothing', async () => {
    const w = world();
    await flow.submitConfession(w.mk(), 'one'); await flow.submitConfession(w.mk(), 'two'); assert.match(txt(w.out.at(-1)), /wait/);
    await flow.submitConfession(w.mk({ user: { id: U2 } }), 'invite discord.gg/xyz'); assert.match(txt(w.out.at(-1)), /invite/);
    assert.strictEqual(w.posted.length, 1);
    w.svc.blockAuthorOf(G, 1); clock += 1e7; await flow.submitConfession(w.mk(), 'blocked now'); assert.match(txt(w.out.at(-1)), /not allowed/); assert.strictEqual(w.posted.length, 1);
});
test('flow: failed post is undone so the member can retry at once', async () => {
    const w = world(); w.channel.send = async () => { throw new Error('no access'); };
    await flow.submitConfession(w.mk(), 'will fail'); assert.match(txt(w.out.at(-1)), /cannot post/);
    assert.strictEqual(w.svc.get(G, 1), null); assert.doesNotThrow(() => w.svc.check(G, U1));
});
test('flow: Confess button opens the form (after checking rules), the form submits', async () => {
    const w = world(); await flow.handleConfessionComponent(w.mk()); assert.strictEqual(w.modals.length, 1); assert.ok(JSON.stringify(w.modals[0]).includes('cf:submit'));
    await flow.handleConfessionComponent(w.mk({ isModalSubmit: () => true, customId: 'cf:submit', fields: { getTextInputValue: () => 'from the form' } }));
    assert.strictEqual(w.posted.length, 1);
    await flow.handleConfessionComponent(w.mk()); assert.strictEqual(w.modals.length, 1); assert.match(txt(w.out.at(-1)), /wait/); // no form during cooldown
});
test('flow: /confess opens the form without text and posts with text', async () => {
    const w = world(); const cmd = require('../src/commands/confessions/confess');
    await cmd.execute(w.mk({ options: { getString: () => null } })); assert.strictEqual(w.modals.length, 1);
    await cmd.execute(w.mk({ options: { getString: () => 'typed text' } })); assert.strictEqual(w.posted.length, 1);
});
test('flow: /confession setup, delete, block (no identity shown), blocked list', async () => {
    const w = world({ config: false, mod: true }); const cmd = require('../src/commands/confessions/confession');
    const sent = []; const admin = (sub, opts = {}) => w.mk({ options: { getSubcommand: () => sub, getChannel: () => ({ id: CH, permissionsFor: () => ({ has: () => true }), send: async (p) => sent.push(p) }), getInteger: (n) => opts[n] ?? null },
        guild: { id: G, members: { fetchMe: async () => ({}) }, channels: { fetch: async () => ({ messages: { delete: async (id) => sent.push(['deleted', id]) } }) } }, memberPermissions: { has: () => true } });
    w.client.services.modLog = { send: async () => {} };
    await cmd.execute(admin('setup', { cooldown: 120 })); assert.strictEqual(w.svc.getConfig(G).channelId, CH); assert.strictEqual(w.svc.getConfig(G).cooldownSeconds, 120); assert.ok(JSON.stringify(sent[0]).includes('cf:new'));
    w.svc.create(G, U1, 'bad one'); w.svc.attachMessage(G, 1, CH, '555555555555555551');
    await cmd.execute(admin('block', { number: 1 })); assert.match(txt(w.out.at(-1)), /You are not shown who/); assert.ok(!txt(w.out.at(-1)).includes(U1));
    await cmd.execute(admin('blocked')); assert.match(txt(w.out.at(-1)), /#1/);
    await cmd.execute(admin('delete', { number: 1 })); assert.deepStrictEqual(sent.at(-1), ['deleted', '555555555555555551']); assert.match(txt(w.out.at(-1)), /deleted/);
    await cmd.execute(admin('delete', { number: 1 })); assert.match(txt(w.out.at(-1)), /already deleted/); await cmd.execute(admin('delete', { number: 9 })); assert.match(txt(w.out.at(-1)), /no confession #9/);
    await cmd.execute(admin('unblock', { number: 1 })); assert.match(txt(w.out.at(-1)), /removed/);
    const denied = admin('setup'); denied.memberPermissions = { has: () => false }; await cmd.execute(denied); assert.match(txt(w.out.at(-1)), /Manage Server|Manage Messages/);
});
test('typed !confess is slash-only: the message is deleted and a pointer is shown', async () => {
    const { handleTextMessage } = require('../src/textcommands/handler');
    const { createTextCommandService } = require('../src/services/textCommandService');
    const { db } = fresh(); const tc = createTextCommandService(db); tc.setEnabled(G, true);
    const { SlashCommandBuilder } = require('discord.js'); let deleted = false; const sent = []; let ran = false;
    const client = { user: { id: '999999999999999999' }, services: { textCommands: tc }, commands: new Map([['confess', { data: new SlashCommandBuilder().setName('confess').setDescription('d'), execute: async () => { ran = true; } }]]) };
    const message = { client, guild: { id: G }, content: '!confess my secret', author: { id: U1, bot: false }, inGuild: () => true, delete: async () => { deleted = true; }, channel: { send: async (p) => sent.push(p) }, member: {} };
    assert.strictEqual(await handleTextMessage(message), true);
    assert.ok(deleted); assert.ok(!ran); assert.match(sent[0].content, /slash command/); assert.ok(!sent[0].content.includes('my secret'));
});
