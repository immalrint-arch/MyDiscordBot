const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createPostService, PostServiceError } = require('../src/services/postService');
const R = require('../src/posts/rules');
const flow = require('../src/posts/postFlow');

const G = '111111111111111111', CH = '444444444444444441', CH2 = '444444444444444442', U = '222222222222222221', ROLE = '555555555555555551', BOT = '999999999999999999';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };
const NOW = Date.UTC(2026, 10, 16, 0, 0);

test('rules: colours, text, embed data', () => {
    assert.strictEqual(R.parseColor('#FF0000'), 0xff0000); assert.strictEqual(R.parseColor('red'), 0xed4245); assert.strictEqual(R.parseColor(''), R.DEFAULT_COLOR); assert.strictEqual(R.parseColor('nope'), null); assert.strictEqual(R.parseColor('#fff'), null);
    assert.strictEqual(R.cleanText('a\\nb ', 10), 'a\nb'); assert.strictEqual(R.cleanText('  ', 10), null); assert.strictEqual(R.cleanText('x'.repeat(11), 10), null);
    assert.deepStrictEqual(R.buildEmbedData({ title: 'Hi', description: 'x\\ny', color: 'green' }).embed, { title: 'Hi', description: 'x\ny', color: 0x57f287 });
    assert.strictEqual(R.buildEmbedData({}).embed, null);
    assert.match(R.buildEmbedData({ title: 'a', image: 'http://x.com/a.png' }).problem, /https/); assert.match(R.buildEmbedData({ title: 'a', image: 'javascript:alert(1)' }).problem, /https/);
    assert.match(R.buildEmbedData({ title: 'a', color: 'zzz' }).problem, /colour/); assert.match(R.buildEmbedData({ title: 'x'.repeat(300) }).problem, /title/);
    assert.ok(R.buildEmbedData({ title: 'a', image: 'https://example.com/a.png' }).embed.image);
});
test('rules: when, next slot, preview', () => {
    assert.strictEqual(R.parseWhen('2h', { now: NOW }).at, NOW + 7200000);
    assert.strictEqual(R.parseWhen('2026-12-25 09:00', { now: NOW, utcOffset: 8 }).at, Date.UTC(2026, 11, 25, 1, 0));
    for (const bad of ['tomorrow', '2026-13-01 10:00', '2026-02-30 10:00', '2026-12-25 25:00', '2020-01-01 10:00', '2h30x']) assert.ok(R.parseWhen(bad, { now: NOW }).problem, bad);
    assert.match(R.parseWhen('400d', { now: NOW }).problem, /year/);
    assert.strictEqual(R.nextSlot(1000, 500, 1000), 1500); assert.strictEqual(R.nextSlot(1000, 500, 2700), 3000); assert.strictEqual(R.nextSlot(1000, 500, 500), 1500);
    assert.strictEqual(R.preview({ content: 'a\n b' }), 'a b'); assert.ok(R.preview({ content: 'x'.repeat(100) }).length <= 60); assert.strictEqual(R.preview({ embed: { title: 'T' } }), 'T');
});

test('service: scheduled add/list/limits/claim exactly once', () => {
    let t = NOW; const s = createPostService(fresh(), { now: () => t }).scheduled;
    assert.throws(() => s.add(G, { channelId: CH, runAt: NOW + 1000, createdBy: U }), PostServiceError);
    assert.throws(() => s.add(G, { channelId: CH, content: 'x', runAt: NOW + 1000, intervalSeconds: 60, createdBy: U }), PostServiceError);
    assert.throws(() => s.add(G, { channelId: CH, content: 'x', runAt: NOW + 1000, intervalSeconds: 3600, maxRuns: 0, createdBy: U }), PostServiceError);
    const once = s.add(G, { channelId: CH, content: 'hello', runAt: NOW + 1000, createdBy: U });
    const rep = s.add(G, { channelId: CH, embed: { title: 'T', color: 1 }, runAt: NOW + 2000, intervalSeconds: 3600, maxRuns: 2, pingRoleId: ROLE, createdBy: U });
    assert.deepStrictEqual(s.list(G).map((p) => p.id), [once, rep]); assert.deepStrictEqual(s.get(G, rep).embed, { title: 'T', color: 1 });
    assert.strictEqual(s.due(NOW).length, 0); t = NOW + 5000; const due = s.due(t); assert.strictEqual(due.length, 2);
    assert.ok(s.claim(due[0], t)); assert.ok(!s.claim(due[0], t), 'second claim fails'); assert.strictEqual(s.get(G, once), null, 'one-time post deleted');
    assert.ok(s.claim(due[1], t)); const after = s.get(G, rep); assert.strictEqual(after.runs, 1); assert.strictEqual(after.nextRunAt, NOW + 2000 + 3600000);
    t = after.nextRunAt; assert.ok(s.claim(s.due(t)[0], t)); assert.strictEqual(s.get(G, rep), null, 'removed after max runs');
    for (let i = 0; i < R.MAX_SCHEDULED; i++) s.add(G, { channelId: CH, content: 'x', runAt: NOW + 9000, createdBy: U }); assert.throws(() => s.add(G, { channelId: CH, content: 'x', runAt: NOW + 9000, createdBy: U }), PostServiceError);
});
test('service: toggle skips missed runs; failures switch a post off', () => {
    let t = NOW; const s = createPostService(fresh(), { now: () => t }).scheduled;
    const id = s.add(G, { channelId: CH, content: 'x', runAt: NOW + 1000, intervalSeconds: 3600, createdBy: U });
    assert.ok(s.setEnabled(G, id, false)); assert.strictEqual(s.due(NOW + 99999999).length, 0);
    t = NOW + 10 * 3600000; assert.ok(s.setEnabled(G, id, true)); const p = s.get(G, id); assert.ok(p.nextRunAt > t && p.nextRunAt <= t + 3600000);
    assert.ok(!s.fail(id)); assert.ok(!s.fail(id)); assert.ok(s.fail(id)); assert.strictEqual(s.get(G, id).enabled, false); assert.ok(!s.setEnabled(G, 9999, true));
    s.setEnabled(G, id, true); assert.strictEqual(s.get(G, id).failCount, 0);
});
test('service: sticky set/replace/limit/remove, per-server', () => {
    const s = createPostService(fresh()).sticky;
    s.set(G, { channelId: CH, content: 'a', createdBy: U }); assert.ok(s.has(G, CH)); assert.ok(!s.has(G, CH2)); assert.ok(!s.has('333333333333333333', CH));
    s.set(G, { channelId: CH, embed: { description: 'b', color: 2 }, createdBy: U }); assert.strictEqual(s.list(G).length, 1); assert.deepStrictEqual(s.get(G, CH).embed, { description: 'b', color: 2 });
    s.setLastMessage(G, CH, '777777777777777771'); assert.strictEqual(s.get(G, CH).lastMessageId, '777777777777777771');
    assert.throws(() => s.set(G, { channelId: CH2, createdBy: U }), PostServiceError);
    for (let i = 0; i < R.MAX_STICKY - 1; i++) s.set(G, { channelId: `66666666666666${String(i).padStart(4, '0')}`, content: 'x', createdBy: U }); assert.throws(() => s.set(G, { channelId: CH2, content: 'x', createdBy: U }), PostServiceError);
    assert.ok(s.remove(G, CH)); assert.ok(!s.has(G, CH)); assert.ok(!s.remove(G, CH));
});

// ---- flows with fake Discord objects ----
const allow = new Set(['ViewChannel', 'SendMessages', 'EmbedLinks', 'MentionEveryone']);
function world({ botCan = true, userCan = true } = {}) {
    const sent = []; const deleted = []; let n = 0;
    const perms = (ok) => ({ has: (p) => (Array.isArray(p) ? p.every(() => ok) : ok) });
    const channel = { id: CH, guildId: G, isTextBased: () => true, permissionsFor: (who) => perms(who?.bot ? botCan : userCan), send: async (p) => { sent.push(p); return { id: `8888888888888888${10 + n++}` }; }, messages: { delete: async (id) => { deleted.push(id); }, fetch: async () => null } };
    const guild = { id: G, members: { me: { bot: true } }, channels: { fetch: async () => channel } };
    const posts = createPostService(fresh());
    const client = { user: { id: BOT }, services: { posts }, channels: { fetch: async () => channel }, users: { fetch: async () => ({ send: async () => {} }) } };
    return { sent, deleted, channel, guild, posts, client };
}
const interaction = (w, sub, opts = {}, perm = true) => { const out = []; return { out, client: w.client, guild: w.guild, guildId: G, user: { id: U }, member: { user: true }, memberPermissions: { has: () => perm }, inGuild: () => true,
    options: { getSubcommand: () => sub, getString: (k) => opts[k] ?? null, getInteger: (k) => opts[k] ?? null, getBoolean: (k) => opts[k] ?? null, getChannel: () => w.channel, getRole: () => opts.role ?? null },
    deferred: false, replied: false, reply(p) { out.push(p); return Promise.resolve(); }, showModal() { this.modal = true; return Promise.resolve(); } }; };

test('payload: only the chosen role can be pinged', () => {
    const p = flow.buildPayload({ content: 'hi @everyone', embed: { title: 'T', color: 1 }, pingRoleId: ROLE });
    assert.strictEqual(p.content, `<@&${ROLE}>\nhi @everyone`); assert.deepStrictEqual(p.allowedMentions, { parse: [], roles: [ROLE] }); assert.strictEqual(p.embeds.length, 1);
    assert.deepStrictEqual(flow.buildPayload({ content: 'x' }).allowedMentions, { parse: [] }); assert.strictEqual(flow.buildPayload({ embed: { title: 'T' } }).content, undefined);
});
test('flow: /embed send checks permissions, validates and posts', async () => {
    let w = world(); let i = interaction(w, 'send', { title: 'Hi', description: 'there', color: 'blue' }); await flow.handleEmbedCommand(i);
    assert.strictEqual(w.sent.length, 1); assert.match(JSON.stringify(i.out), /Sent to/);
    i = interaction(w, 'send', { title: 'Hi', image: 'http://bad' }); await flow.handleEmbedCommand(i); assert.strictEqual(w.sent.length, 1); assert.match(JSON.stringify(i.out), /https/);
    i = interaction(w, 'send', {}); await flow.handleEmbedCommand(i); assert.strictEqual(w.sent.length, 1);
    i = interaction(w, 'send', { title: 'Hi' }, false); await flow.handleEmbedCommand(i); assert.strictEqual(w.sent.length, 1); assert.match(JSON.stringify(i.out), /permission/);
    w = world({ botCan: false }); i = interaction(w, 'send', { title: 'Hi' }); await flow.handleEmbedCommand(i); assert.strictEqual(w.sent.length, 0); assert.match(JSON.stringify(i.out), /I need/);
    w = world({ userCan: false }); i = interaction(w, 'send', { title: 'Hi' }); await flow.handleEmbedCommand(i); assert.strictEqual(w.sent.length, 0); assert.match(JSON.stringify(i.out), /You cannot send/);
    w = world(); i = interaction(w, 'send', { title: 'Hi', role: { id: ROLE, name: 'News', mentionable: true } }); await flow.handleEmbedCommand(i); assert.deepStrictEqual(w.sent[0].allowedMentions.roles, [ROLE]);
});
test('flow: /embed form opens the modal; modal submit posts', async () => {
    const w = world(); const i = interaction(w, 'form'); await flow.handleEmbedCommand(i); assert.ok(i.modal);
    const out = []; await flow.handlePostComponent({ customId: `ep:send:${CH}`, isModalSubmit: () => true, guild: w.guild, guildId: G, member: {}, memberPermissions: { has: () => true }, user: { id: U }, client: w.client, fields: { getTextInputValue: (f) => ({ description: 'Body', title: 'T' }[f] ?? '') }, deferred: false, replied: false, reply: (p) => { out.push(p); return Promise.resolve(); } });
    assert.strictEqual(w.sent.length, 1); await flow.handlePostComponent({ customId: `ep:send:${CH}`, isModalSubmit: () => true, guild: w.guild, memberPermissions: { has: () => false }, fields: {}, reply: (p) => { out.push(p); return Promise.resolve(); } }); assert.strictEqual(w.sent.length, 1);
});
test('flow: /schedule add validates and stores; list, toggle, remove', async () => {
    const w = world(); const run = async (sub, opts, perm) => { const i = interaction(w, sub, opts, perm); await flow.handleScheduleCommand(i); return JSON.stringify(i.out); };
    assert.match(await run('add', { when: '2h', message: 'Hello' }), /Scheduled post/); assert.strictEqual(w.posts.scheduled.list(G).length, 1);
    assert.match(await run('add', { when: 'soon', message: 'Hello' }), /Write the time/); assert.match(await run('add', { when: '2h' }), /Add a/);
    assert.match(await run('add', { when: '2h', message: 'x', times: 3 }), /repeat/); assert.match(await run('add', { when: '2h', message: 'x', repeat: '1m' }), /10 minutes/);
    assert.match(await run('add', { when: '2h', message: 'x', repeat: 'abc' }), /repeat time/);
    assert.match(await run('add', { when: '2h', message: 'x', repeat: '1d', times: 3 }), /every 1d/);
    assert.match(await run('list', {}), /#1/); assert.match(await run('toggle', { id: 1, enabled: false }), /off/); assert.match(await run('remove', { id: 99 }), /no scheduled/);
    assert.match(await run('remove', { id: 1 }), /deleted/); assert.match(await run('add', { when: '2h', message: 'x' }, false), /permission/);
});
test('scheduler: sends due posts once, skips ones a day late, switches failing repeats off', async () => {
    const w = world(); const s = w.posts.scheduled; const t = Date.now();
    const a = s.add(G, { channelId: CH, content: 'now', runAt: t + 1, createdBy: U });
    const late = s.add(G, { channelId: CH, content: 'old', runAt: t + 2, createdBy: U });
    await flow.postsTick(w.client, t + 100); assert.strictEqual(w.sent.length, 2); await flow.postsTick(w.client, t + 200); assert.strictEqual(w.sent.length, 2, 'not twice');
    s.add(G, { channelId: CH, content: 'missed', runAt: t + 1, createdBy: U }); await flow.postsTick(w.client, t + 2 * 86400000); assert.strictEqual(w.sent.length, 2, 'too late: skipped'); assert.strictEqual(s.list(G).length, 0);
    const bad = world(); bad.client.channels.fetch = async () => { throw new Error('gone'); }; const id = bad.posts.scheduled.add(G, { channelId: CH, content: 'x', runAt: t + 1, intervalSeconds: 600, createdBy: U });
    for (let k = 0; k < 3; k++) await flow.postsTick(bad.client, t + 1000 + k * 600000); assert.strictEqual(bad.posts.scheduled.get(G, id).enabled, false);
    assert.ok(a && late);
});
test('sticky: set posts at once, repost deletes the old copy, own messages ignored, bursts debounced, remove cleans up', async () => {
    const w = world(); await flow.handleStickyCommand(interaction(w, 'set', { text: 'Be kind', title: 'Rules' })); assert.strictEqual(w.sent.length, 1); const first = w.posts.sticky.get(G, CH).lastMessageId; assert.ok(first);
    const msg = (extra = {}) => ({ client: w.client, guild: w.guild, channelId: CH, author: { id: U }, ...extra });
    await flow.handleStickyMessage(msg({ author: { id: BOT } }), { delayMs: 5 }); assert.strictEqual(flow.pending.size, 0);
    await flow.handleStickyMessage(msg({ channelId: CH2 }), { delayMs: 5 }); assert.strictEqual(flow.pending.size, 0);
    await flow.handleStickyMessage(msg(), { delayMs: 5 }); await flow.handleStickyMessage(msg(), { delayMs: 5 }); await flow.handleStickyMessage(msg(), { delayMs: 5 }); assert.strictEqual(flow.pending.size, 1);
    await new Promise((r) => setTimeout(r, 60)); assert.strictEqual(w.sent.length, 2, 'one repost for the burst'); assert.deepStrictEqual(w.deleted, [first]); assert.notStrictEqual(w.posts.sticky.get(G, CH).lastMessageId, first);
    const i = interaction(w, 'remove', {}); await flow.handleStickyCommand(i); assert.ok(!w.posts.sticky.has(G, CH)); assert.strictEqual(w.deleted.length, 2); assert.match(JSON.stringify(i.out), /removed/);
    await flow.handleStickyMessage(msg(), { delayMs: 5 }); assert.strictEqual(flow.pending.size, 0);
    const j = interaction(w, 'set', { text: 'x' }, false); await flow.handleStickyCommand(j); assert.ok(!w.posts.sticky.has(G, CH));
});
test('command files load with the right names', () => {
    for (const n of ['embed', 'schedule', 'sticky']) { const c = require(`../src/commands/posts/${n}`); assert.strictEqual(c.data.name, n); assert.strictEqual(typeof c.execute, 'function'); }
});
