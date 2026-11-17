const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createPollService, PollServiceError } = require('../src/services/pollService');
const { createReminderService, ReminderServiceError } = require('../src/services/reminderService');
const { createSuggestionService, SuggestionServiceError } = require('../src/services/suggestionService');
const { createStarboardService, StarboardServiceError } = require('../src/services/starboardService');
const rules = require('../src/utility/rules');
const flow = require('../src/utility/utilityFlow');
const { PermissionFlagsBits } = require('discord.js');

const G = '111111111111111111', CH = '444444444444444441', STAR = '444444444444444442', U1 = '222222222222222221', U2 = '222222222222222222', U3 = '222222222222222223', MODID = '222222222222222229';
let clock = Date.parse('2026-11-12T00:00:00Z');
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };
const opts = { now: () => clock };
const txt = (p) => (typeof p === 'string' ? p : p?.content ?? '');
const json = (x) => JSON.stringify(x);

test('rules: poll options, tally, bar', () => {
    assert.deepStrictEqual(rules.parseOptions('Pizza | Burgers ;Tacos\n pizza ').options, ['Pizza', 'Burgers', 'Tacos']); // duplicates (any case) collapse
    assert.match(rules.parseOptions('only one').problem, /at least 2/); assert.match(rules.parseOptions(Array.from({ length: 11 }, (_, i) => `o${i}`).join('|')).problem, /at most 10/);
    assert.match(rules.parseOptions(`a|${'x'.repeat(81)}`).problem, /80/);
    assert.deepStrictEqual(rules.tally(3, [{ option_index: 0 }, { option_index: 0 }, { option_index: 2 }, { option_index: 9 }]).map((r) => [r.count, r.percent]), [[2, 67], [0, 0], [1, 33]]);
    assert.deepStrictEqual(rules.tally(2, []).map((r) => r.percent), [0, 0]);
    assert.strictEqual(rules.bar(50), '▰▰▰▰▰▱▱▱▱▱'); assert.strictEqual(rules.bar(0).length, 10);
});
test('rules: starboard decisions and emoji matching', () => {
    assert.strictEqual(rules.starAction(3, 3, null), 'create'); assert.strictEqual(rules.starAction(2, 3, null), 'none');
    assert.strictEqual(rules.starAction(4, 3, { stars: 3 }), 'update'); assert.strictEqual(rules.starAction(3, 3, { stars: 3 }), 'none'); assert.strictEqual(rules.starAction(2, 3, { stars: 3 }), 'remove');
    assert.ok(rules.emojiMatches('⭐', { name: '⭐', id: null })); assert.ok(!rules.emojiMatches('⭐', { name: '🌟' })); assert.ok(rules.emojiMatches('<:cool:123456789012345678>', { id: '123456789012345678', name: 'cool' }));
    assert.strictEqual(rules.parseEmojiInput('⭐'), '⭐'); assert.strictEqual(rules.parseEmojiInput('hello'), null); assert.strictEqual(rules.parseEmojiInput('<:a:123456789012345678>'), '<:a:123456789012345678>');
});

test('poll service: create, limits, voting rules, exactly-once end, due list', () => {
    const s = createPollService(fresh(), opts);
    assert.throws(() => s.create(G, { channelId: CH, creatorId: U1, question: ' ', optionsText: 'a|b' }), PollServiceError);
    assert.throws(() => s.create(G, { channelId: CH, creatorId: U1, question: 'q', optionsText: 'a' }), PollServiceError);
    assert.throws(() => s.create(G, { channelId: CH, creatorId: U1, question: 'q', optionsText: 'a|b', durationMs: 1000 }), /between 1 minute/);
    const p = s.create(G, { channelId: CH, creatorId: U1, question: 'Best?', optionsText: 'a|b|c', durationMs: 60000 }); assert.strictEqual(p.number, 1); assert.strictEqual(p.endsAt, clock + 60000);
    assert.strictEqual(s.vote(p.id, U1, 0).changed, 'added'); assert.strictEqual(s.vote(p.id, U1, 1).changed, 'added'); // single choice: replaced
    assert.deepStrictEqual(s.results(p.id).rows.map((r) => r.count), [0, 1, 0]);
    assert.strictEqual(s.vote(p.id, U1, 1).changed, 'removed'); assert.strictEqual(s.vote(p.id, U1, 7).changed, 'invalid');
    const m = s.create(G, { channelId: CH, creatorId: U1, question: 'multi', optionsText: 'a|b', multiple: true });
    s.vote(m.id, U2, 0); s.vote(m.id, U2, 1); assert.strictEqual(s.results(m.id).voters, 1); assert.deepStrictEqual(s.results(m.id).rows.map((r) => r.count), [1, 1]);
    assert.strictEqual(s.due(clock + 59999).length, 0); assert.strictEqual(s.due(clock + 60000).length, 1);
    assert.ok(s.end(G, 1)); assert.strictEqual(s.end(G, 1), null); assert.strictEqual(s.vote(p.id, U2, 0).changed, 'closed');
    clock += 120000; assert.strictEqual(s.vote(m.id, U3, 0).changed, 'added'); // no end time -> stays open
    for (let i = 0; i < 9; i++) s.create(G, { channelId: CH, creatorId: U1, question: `q${i}`, optionsText: 'a|b' });
    assert.throws(() => s.create(G, { channelId: CH, creatorId: U1, question: 'too many', optionsText: 'a|b' }), /open polls/);
});
test('poll service: voting after the end time is refused even before the scheduler runs', () => {
    const s = createPollService(fresh(), opts); clock = Date.parse('2026-11-12T00:00:00Z');
    const p = s.create(G, { channelId: CH, creatorId: U1, question: 'q', optionsText: 'a|b', durationMs: 60000 });
    clock += 61000; assert.strictEqual(s.vote(p.id, U2, 0).changed, 'closed');
});
test('reminder service: validation, limits, ownership, claim once', () => {
    clock = Date.parse('2026-11-12T00:00:00Z'); const s = createReminderService(fresh(), opts);
    for (const bad of [{ text: ' ', delayMs: 60000 }, { text: 'x', delayMs: 5000 }, { text: 'x', delayMs: 400 * 864e5 }, { text: 'x'.repeat(501), delayMs: 60000 }]) assert.throws(() => s.create(G, { userId: U1, channelId: CH, ...bad }), ReminderServiceError);
    const r = s.create(G, { userId: U1, channelId: CH, text: 'call mom', delayMs: 60000 }); assert.strictEqual(r.dueAt, clock + 60000);
    assert.strictEqual(s.listForUser(G, U1).length, 1); assert.strictEqual(s.listForUser(G, U2).length, 0);
    assert.ok(!s.cancel(G, U2, r.id)); assert.strictEqual(s.due(clock + 59999).length, 0); assert.strictEqual(s.due(clock + 60000).length, 1);
    assert.ok(s.claim(r.id)); assert.ok(!s.claim(r.id)); assert.strictEqual(s.due(clock + 1e9).length, 0);
    const c = s.create(G, { userId: U1, channelId: CH, text: 'later', delayMs: 60000 }); assert.ok(s.cancel(G, U1, c.id)); assert.ok(!s.cancel(G, U1, c.id)); assert.ok(!s.claim(c.id));
    for (let i = 0; i < 25; i++) s.create(G, { userId: U2, channelId: CH, text: `r${i}`, delayMs: 60000 });
    assert.throws(() => s.create(G, { userId: U2, channelId: CH, text: 'over', delayMs: 60000 }), /25 reminders/);
});
test('suggestion service: cooldown, numbering, votes switch/toggle, status only once decided', () => {
    clock = Date.parse('2026-11-12T00:00:00Z'); const s = createSuggestionService(fresh(), opts);
    assert.strictEqual(s.getChannelId(G), null); s.setChannel(G, CH); assert.strictEqual(s.getChannelId(G), CH);
    assert.throws(() => s.create(G, { authorId: U1, content: ' ' }), SuggestionServiceError);
    const a = s.create(G, { authorId: U1, content: 'more pizza' }); assert.strictEqual(a.number, 1);
    assert.throws(() => s.create(G, { authorId: U1, content: 'again' }), /wait/); assert.strictEqual(s.create(G, { authorId: U2, content: 'x' }).number, 2);
    assert.strictEqual(s.vote(a.id, U3, 1), 'added'); assert.strictEqual(s.vote(a.id, U3, -1), 'changed'); assert.deepStrictEqual(s.counts(a.id), { up: 0, down: 1 });
    assert.strictEqual(s.vote(a.id, U3, -1), 'removed'); assert.deepStrictEqual(s.counts(a.id), { up: 0, down: 0 });
    assert.strictEqual(s.setStatus(G, 1, 'considered', MODID, 'maybe').status, 'considered'); assert.strictEqual(s.setStatus(G, 1, 'approved', MODID).status, 'approved');
    assert.strictEqual(s.setStatus(G, 1, 'denied', MODID), null); assert.strictEqual(s.vote(a.id, U3, 1), 'closed'); assert.throws(() => s.setStatus(G, 1, 'bogus', MODID), TypeError);
});
test('starboard service: config validation and saved posts', () => {
    const s = createStarboardService(fresh());
    assert.deepStrictEqual(s.getConfig(G), { channelId: null, threshold: 3, emoji: '⭐' });
    s.setup(G, { channelId: STAR, threshold: 5, emoji: '🌟' }); assert.deepStrictEqual(s.getConfig(G), { channelId: STAR, threshold: 5, emoji: '🌟' });
    assert.throws(() => s.setup(G, { threshold: 0 }), StarboardServiceError); assert.throws(() => s.setup(G, { emoji: 'nope' }), StarboardServiceError);
    s.savePost(G, { sourceMessageId: '1', sourceChannelId: CH, starChannelId: STAR, starMessageId: '2', stars: 3 }); s.savePost(G, { sourceMessageId: '1', sourceChannelId: CH, starChannelId: STAR, starMessageId: '2', stars: 4 });
    assert.strictEqual(s.getPost(G, '1').stars, 4); assert.strictEqual(s.countPosts(G), 1); s.deletePost(G, '1'); assert.strictEqual(s.getPost(G, '1'), null);
});

// ---------- flows ----------
function world() {
    clock = Date.parse('2026-11-12T00:00:00Z'); const db = fresh();
    const services = { polls: createPollService(db, opts), reminders: createReminderService(db, opts), suggestions: createSuggestionService(db, opts), starboard: createStarboardService(db) };
    const sent = []; const edits = []; const deleted = []; const dms = []; const msgStore = new Map(); let n = 0;
    const channel = { id: CH, send: async (p) => { const m = { id: `70000000000000${String(++n).padStart(4, '0')}`, edit: async (x) => edits.push([m.id, x]), reply: async (x) => sent.push(['reply', x]) }; msgStore.set(m.id, m); sent.push(p); return m; },
        isTextBased: () => true, messages: { fetch: async (id) => msgStore.get(id) ?? null, delete: async (id) => { deleted.push(id); } } };
    const starChannel = { id: STAR, send: channel.send, messages: channel.messages, isTextBased: () => true };
    const guild = { id: G, name: 'Test', channels: { fetch: async (id) => (id === STAR ? starChannel : channel) } };
    const client = { services, guilds: { cache: new Map([[G, guild]]) }, users: { fetch: async (id) => ({ id, username: `u${id.slice(-2)}`, send: async (p) => dms.push(p) }) } };
    return { services, client, guild, channel, sent, edits, deleted, dms, msgStore };
}
const press = (w, customId, user = U1, extra = {}) => { const out = []; return { out, i: { client: w.client, guildId: G, customId, user: { id: user }, update: async (p) => out.push(['update', p]), reply: async (p) => out.push(['reply', p]), ...extra } }; };

test('flow: poll buttons vote and update the same message; ended polls say so privately', async () => {
    const w = world(); const poll = w.services.polls.create(G, { channelId: CH, creatorId: U1, question: 'Best?', optionsText: 'Pizza|Burgers|Tacos', durationMs: 60000 });
    const p1 = press(w, `pl:v:${poll.id}:1`, U1); await flow.handlePollButton(p1.i);
    assert.strictEqual(p1.out[0][0], 'update'); assert.ok(json(p1.out[0][1]).includes('Burgers')); assert.match(json(p1.out[0][1]), /\*\*1\*\* · 100%/);
    const comps = json(p1.out[0][1].components); assert.ok(comps.includes(`pl:v:${poll.id}:0`) && comps.includes(`pl:v:${poll.id}:2`));
    w.services.polls.end(G, 1); const p2 = press(w, `pl:v:${poll.id}:0`, U2); await flow.handlePollButton(p2.i); assert.match(txt(p2.out[0][1]), /ended/);
    const p3 = press(w, 'pl:v:99999:0', U2); await flow.handlePollButton(p3.i); assert.match(txt(p3.out[0][1]), /does not exist/);
});
test('flow: ending a poll posts the winner once; the timer ends due polls', async () => {
    const w = world(); const poll = w.services.polls.create(G, { channelId: CH, creatorId: U1, question: 'Best?', optionsText: 'Pizza|Burgers', durationMs: 60000 });
    const m = await w.channel.send({}); w.services.polls.attachMessage(G, 1, m.id); w.services.polls.vote(poll.id, U1, 1); w.services.polls.vote(poll.id, U2, 1); w.services.polls.vote(poll.id, U3, 0);
    await flow.utilityTick(w.client, clock + 30000); assert.strictEqual(w.services.polls.get(G, 1).status, 'open');
    await flow.utilityTick(w.client, clock + 61000); assert.strictEqual(w.services.polls.get(G, 1).status, 'ended');
    assert.ok(w.edits.some(([, p]) => json(p).includes('Poll ended'))); assert.ok(w.sent.some((x) => x[0] === 'reply' && /Winner: \*\*Burgers\*\*/.test(x[1].content)));
    const replies = w.sent.filter((x) => x[0] === 'reply').length; await flow.utilityTick(w.client, clock + 120000); assert.strictEqual(w.sent.filter((x) => x[0] === 'reply').length, replies); // not twice
    assert.strictEqual(await flow.endPoll(w.client, G, 1), null);
});
test('flow: reminders arrive once, only mention the owner, say when late, fall back to a DM', async () => {
    const w = world(); const r = w.services.reminders.create(G, { userId: U1, channelId: CH, text: 'call mom @everyone', delayMs: 60000 });
    await flow.utilityTick(w.client, clock + 59000); assert.strictEqual(w.sent.length, 0);
    await flow.utilityTick(w.client, clock + 61000); assert.strictEqual(w.sent.length, 1);
    assert.match(w.sent[0].content, new RegExp(`<@${U1}> reminder: call mom`)); assert.deepStrictEqual(w.sent[0].allowedMentions, { users: [U1] });
    await flow.utilityTick(w.client, clock + 62000); assert.strictEqual(w.sent.length, 1);
    w.services.reminders.create(G, { userId: U2, channelId: CH, text: 'late one', delayMs: 60000 }); await flow.utilityTick(w.client, clock + 60 * 60 * 1000); assert.match(w.sent[1].content, /a bit late/);
    w.channel.send = async () => { throw new Error('gone'); }; w.services.reminders.create(G, { userId: U3, channelId: CH, text: 'dm me', delayMs: 60000 });
    await flow.utilityTick(w.client, clock + 2 * 60 * 60 * 1000); assert.match(w.dms[0].content, /dm me/);
});
test('flow: suggestions post with vote buttons, votes update, staff decisions close voting', async () => {
    const w = world(); const suggest = require('../src/commands/utility/suggest'); const staff = require('../src/commands/utility/suggestion'); const out = [];
    const base = { client: w.client, guild: { ...w.guild, members: { fetchMe: async () => ({}) } }, guildId: G, user: { id: U1, username: 'u1', displayName: 'U1', displayAvatarURL: () => 'x' }, memberPermissions: { has: () => true },
        deferReply: async () => {}, editReply: async (p) => { out.push(p); return { id: 'm' }; }, reply: async (p) => out.push(p), deferred: true, inGuild: () => true };
    await suggest.execute({ ...base, options: { getString: () => 'more pizza' } }); assert.match(txt(out.at(-1)), /not set up/);
    w.services.suggestions.setChannel(G, CH);
    await suggest.execute({ ...base, options: { getString: () => 'more pizza' } }); assert.match(txt(out.at(-1)), /suggestion \*\*#1\*\* was posted/);
    assert.ok(json(w.sent[0]).includes('Suggestion #1') && json(w.sent[0]).includes('sg:up:1'));
    const v = press(w, 'sg:up:1', U2); await flow.handleSuggestionButton(v.i); assert.ok(json(v.out[0][1].components).includes('"👍"') || json(v.out[0][1].components).includes('👍')); assert.deepStrictEqual(w.services.suggestions.counts(1), { up: 1, down: 0 });
    await staff.execute({ ...base, options: { getSubcommand: () => 'approve', getInteger: () => 1, getString: () => 'Great idea', getChannel: () => null } });
    assert.strictEqual(w.services.suggestions.get(G, 1).status, 'approved'); assert.ok(w.edits.some(([, p]) => json(p).includes('3066993') && p.components.length === 0)); // green (approved) and the vote buttons are gone
    const late = press(w, 'sg:down:1', U3); await flow.handleSuggestionButton(late.i); assert.match(txt(late.out[0][1]), /closed/);
    await staff.execute({ ...base, options: { getSubcommand: () => 'deny', getInteger: () => 1, getString: () => null, getChannel: () => null } }); assert.match(txt(out.at(-1)), /already decided/);
});
function starWorld() {
    const w = world(); w.services.starboard.setup(G, { channelId: STAR, threshold: 3 });
    const message = { id: '800000000000000001', channelId: CH, guild: w.guild, author: { id: U1, username: 'author', displayAvatarURL: () => 'a' }, content: 'a great message', url: 'https://discord.com/x', attachments: new Map(), createdTimestamp: 1, channel: { nsfw: false }, partial: false };
    message.attachments.find = () => null;
    const reactors = new Map(); const reaction = (count) => ({ partial: false, message, emoji: { name: '⭐', id: null }, count, users: { fetch: async () => { const m = new Map(reactors); m.filter = (fn) => { const o = new Map(); for (const [k, u] of m) if (fn(u)) o.set(k, u); return o; }; return m; } } });
    const set = (...ids) => { reactors.clear(); for (const id of ids) reactors.set(id, { id, bot: id === 'bot' }); };
    return { w, message, reaction, set };
}
test('flow: starboard posts at the threshold (self-stars and bots do not count), updates, and removes below it', async () => {
    const { w, message, reaction, set } = starWorld();
    set(U1, U2, U3, 'bot'); await flow.handleStarReaction(reaction(4), w.client); assert.strictEqual(w.sent.length, 0); // only 2 real stars
    set(U1, U2, U3, '222222222222222224'); await flow.handleStarReaction(reaction(4), w.client);
    assert.strictEqual(w.sent.length, 1); assert.match(w.sent[0].content, /⭐ \*\*3\*\*/); assert.ok(json(w.sent[0]).includes('a great message')); assert.ok(json(w.sent[0]).includes('Jump to message'));
    assert.strictEqual(w.services.starboard.getPost(G, message.id).stars, 3);
    set(U1, U2, U3, '222222222222222224', '222222222222222225'); await flow.handleStarReaction(reaction(5), w.client); assert.strictEqual(w.sent.length, 1); assert.ok(w.edits.some(([, p]) => /\*\*4\*\*/.test(p.content)));
    set(U1, U2); await flow.handleStarReaction(reaction(2), w.client); assert.strictEqual(w.deleted.length, 1); assert.strictEqual(w.services.starboard.getPost(G, message.id), null);
});
test('flow: starboard ignores other emoji, the starboard channel itself, NSFW channels, and quick double reactions post once', async () => {
    const { w, message, reaction, set } = starWorld(); set(U1, U2, U3, '222222222222222224');
    await flow.handleStarReaction({ ...reaction(4), emoji: { name: '🔥', id: null } }, w.client); assert.strictEqual(w.sent.length, 0);
    await flow.handleStarReaction({ ...reaction(4), message: { ...message, channelId: STAR } }, w.client); assert.strictEqual(w.sent.length, 0);
    await flow.handleStarReaction({ ...reaction(4), message: { ...message, channel: { nsfw: true } } }, w.client); assert.strictEqual(w.sent.length, 0);
    await Promise.all([flow.handleStarReaction(reaction(4), w.client), flow.handleStarReaction(reaction(4), w.client), flow.handleStarReaction(reaction(4), w.client)]);
    assert.strictEqual(w.sent.length, 1);
});
test('commands: /poll create posts the poll, /remind add schedules, wrong input is explained', async () => {
    const w = world(); const poll = require('../src/commands/utility/poll'); const remind = require('../src/commands/utility/remind'); const out = [];
    const base = (o, sub) => ({ client: w.client, guild: w.guild, guildId: G, channelId: CH, user: { id: U1 }, memberPermissions: { has: () => false }, deferReply: async () => {}, fetchReply: async () => ({ id: '900000000000000001' }),
        editReply: async (p) => { out.push(p); return { id: '900000000000000001' }; }, reply: async (p) => out.push(p), deferred: true,
        options: { getSubcommand: () => sub, getString: (n) => o[n] ?? null, getBoolean: (n) => o[n] ?? null, getInteger: (n) => o[n] ?? null } });
    await poll.execute(base({ question: 'Best?', options: 'a|b', duration: 'soon' }, 'create')); assert.match(txt(out.at(-1)), /could not read that duration/);
    await poll.execute(base({ question: 'Best?', options: 'a' }, 'create')); assert.match(txt(out.at(-1)), /at least 2/);
    await poll.execute(base({ question: 'Best?', options: 'Pizza | Tacos', duration: '1h' }, 'create')); assert.ok(json(out.at(-1)).includes('Poll #1')); assert.strictEqual(w.services.polls.get(G, 1).messageId, '900000000000000001');
    await poll.execute(base({ number: 1 }, 'end')); assert.match(txt(out.at(-1)), /Poll #1 ended/); // the creator may end it
    await remind.execute(base({ when: 'whenever', text: 'x' }, 'add')); assert.match(txt(out.at(-1)), /could not read that time/);
    await remind.execute(base({ when: '10m', text: 'call mom' }, 'add')); assert.match(txt(out.at(-1)), /I will remind you/); assert.strictEqual(w.services.reminders.listForUser(G, U1).length, 1);
    await remind.execute(base({ when: '5s', text: 'too soon' }, 'add')); assert.match(txt(out.at(-1)), /at least 10 seconds/);
    await remind.execute(base({ id: 1 }, 'cancel')); assert.match(txt(out.at(-1)), /cancelled/); await remind.execute(base({}, 'list')); assert.match(txt(out.at(-1)), /no reminders/);
});
