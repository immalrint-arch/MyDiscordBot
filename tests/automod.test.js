const test = require('node:test');
const assert = require('node:assert');
const d = require('../src/automod/detectors');
const { evaluate } = require('../src/automod/engine');
const { RULES } = require('../src/automod/rules');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createAutomodService } = require('../src/services/automodService');
const { createGuildSettingsService } = require('../src/services/guildSettingsService');
const { createLogConfigService } = require('../src/services/logConfigService');

const G = '111111111111111111', U = '222222222222222222', CH = '333333333333333333';

test('caps: shouting is caught, but WHATTTTTT and short messages are not', () => {
    assert.strictEqual(d.isExcessiveCaps('WHATTTTTT'), false);
    assert.strictEqual(d.isExcessiveCaps('NOOOOOOOO WHYYYYYYY NOOOOOOO'), false);
    assert.strictEqual(d.isExcessiveCaps('OK THANKS'), false); // too short
    assert.strictEqual(d.isExcessiveCaps('Hello there, how are you doing today?'), false);
    assert.strictEqual(d.isExcessiveCaps('WHAT IS GOING ON HERE EVERYONE'), true);
    assert.strictEqual(d.isExcessiveCaps('LOOK AT https://EXAMPLE.COM/ABCDEFGHIJKLMNOP'), false); // links do not count
    assert.strictEqual(d.isExcessiveCaps('<@123456789012345678> HELP ME'), false);
});

test('invites and links', () => {
    assert.strictEqual(d.findInvite('join discord.gg/abc123 now', []), 'abc123');
    assert.strictEqual(d.findInvite('discord.com/invite/XYZ-9', []), 'XYZ-9');
    assert.strictEqual(d.findInvite('discord.gg/abc123', ['ABC123']), null);
    assert.strictEqual(d.findInvite('nothing here', []), null);
    assert.strictEqual(d.findLink('see https://www.example.com/x', ['example.com']), null);
    assert.strictEqual(d.findLink('http://evil.test/a', ['example.com']), 'evil.test');
    assert.strictEqual(d.findLink('http://notexample.com', ['example.com']), 'notexample.com');
});

test('banned words: whole words, simple tricks, no false positives', () => {
    assert.strictEqual(d.findBannedWord('that is bad', ['bad']), 'bad');
    assert.strictEqual(d.findBannedWord('that is b.a.d', ['bad']), 'bad');
    assert.strictEqual(d.findBannedWord('that is b4d', ['bad']), 'bad');
    assert.strictEqual(d.findBannedWord('BAD', ['bad']), 'bad');
    assert.strictEqual(d.findBannedWord('classy', ['ass']), null);
    assert.strictEqual(d.findBannedWord('a bad word here', ['bad word']), 'bad word');
    assert.strictEqual(d.findBannedWord('anything', []), null);
});

test('emoji counting', () => {
    assert.strictEqual(d.countEmojis('hi 😀😀 <:a:123456789012345678>'), 3);
    assert.strictEqual(d.countEmojis('plain text'), 0);
});

test('spam tracker: window and duplicates', () => {
    let clock = 1000000;
    const t = d.createSpamTracker({ now: () => clock });
    for (let i = 0; i < 4; i++) { t.record(G, U, 'hello ' + i); clock += 1000; }
    assert.strictEqual(t.countRecent(G, U, 5), 4);
    clock += 10000;
    assert.strictEqual(t.countRecent(G, U, 5), 0);
    t.record(G, U, 'Same!'); t.record(G, U, 'same'); t.record(G, U, ' SAME ');
    assert.strictEqual(t.countDuplicates(G, U, 'same', 30), 3);
    assert.strictEqual(t.countDuplicates(G, 'other', 'same', 30), 0);
});

function rules(overrides = {}) {
    const r = {};
    for (const [name, def] of Object.entries(RULES)) r[name] = { enabled: def.enabled, action: def.action, limit: def.limit, window: def.window };
    for (const [k, v] of Object.entries(overrides)) Object.assign(r[k], v);
    return r;
}
const lists = { word: ['bad'], domain: [], invite: [] };

test('engine: finds the right rule, disabled rules are skipped', () => {
    const tracker = d.createSpamTracker();
    const run = (content, extra = {}, ov = {}) => evaluate({ guildId: G, userId: U + Math.random(), content, mentionCount: 0, rules: rules(ov), lists, tracker, ...extra });
    assert.strictEqual(run('hello world'), null);
    assert.strictEqual(run('join discord.gg/abc').rule, 'invites');
    assert.strictEqual(run('you are bad').rule, 'words');
    assert.strictEqual(run('hi', { mentionCount: 6 }).rule, 'mentions');
    assert.strictEqual(run('hi', { mentionCount: 6 }, { mentions: { enabled: false } }), null);
    assert.strictEqual(run('visit https://x.test'), null); // links rule is OFF by default
    assert.strictEqual(run('visit https://x.test', {}, { links: { enabled: true } }).rule, 'links');
    assert.strictEqual(run('LOOK AT THIS EVERYONE RIGHT NOW').rule, 'caps');
});

test('engine: spam and duplicates over several messages', () => {
    const tracker = d.createSpamTracker();
    const args = (c) => ({ guildId: G, userId: U, content: c, mentionCount: 0, rules: rules(), lists, tracker });
    assert.strictEqual(evaluate(args('same thing')), null);
    assert.strictEqual(evaluate(args('same thing')), null);
    assert.strictEqual(evaluate(args('same thing')).rule, 'duplicates');
    const t2 = d.createSpamTracker();
    let hit = null;
    for (let i = 0; i < 5 && !hit; i++) hit = evaluate({ guildId: G, userId: U, content: 'message number ' + 'abcdefg'[i], mentionCount: 0, rules: rules(), lists, tracker: t2 });
    assert.strictEqual(hit.rule, 'spam');
});

const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };

test('service: OFF by default, toggles, rule overrides validate', () => {
    const a = createAutomodService(fresh());
    assert.strictEqual(a.getConfig(G).enabled, false);
    a.setEnabled(G, true);
    assert.strictEqual(a.getConfig(G).enabled, true);
    a.setRule(G, 'spam', { limit: 8, window: 10, action: 'timeout' });
    assert.deepStrictEqual(a.getConfig(G).rules.spam, { enabled: true, action: 'timeout', limit: 8, window: 10 });
    assert.throws(() => a.setRule(G, 'spam', { limit: 1 }), TypeError);
    assert.throws(() => a.setRule(G, 'invites', { limit: 5 }), TypeError);
    assert.throws(() => a.setRule(G, 'nope', { enabled: true }), TypeError);
    a.resetRule(G, 'spam');
    assert.strictEqual(a.getConfig(G).rules.spam.limit, 5);
    assert.throws(() => a.setPunishment(G, { strikeLimit: 0 }), TypeError);
});

test('service: lists, exemptions, strikes, stats', () => {
    let clock = 1000000;
    const a = createAutomodService(fresh(), { now: () => clock });
    assert.deepStrictEqual(a.addListItem(G, 'domain', 'https://www.Example.com/page'), { added: true, value: 'example.com' });
    assert.ok(!a.addListItem(G, 'domain', 'example.com').added);
    assert.deepStrictEqual(a.addListItem(G, 'invite', 'https://discord.gg/AbC'), { added: true, value: 'abc' });
    a.addListItem(G, 'word', 'Bad');
    assert.deepStrictEqual(a.getConfig(G).lists.word, ['bad']);
    assert.ok(a.removeListItem(G, 'word', 'BAD'));
    assert.ok(a.addExempt(G, 'channel', CH));
    assert.deepStrictEqual(a.getConfig(G).exempt.channel, [CH]);
    assert.throws(() => a.addExempt(G, 'role', 'abc'), TypeError);

    a.addStrike(G, U, 'spam', clock); a.addStrike(G, U, 'caps', clock - 20 * 60000);
    assert.strictEqual(a.countStrikes(G, U, clock - 10 * 60000), 1);
    assert.strictEqual(a.clearStrikes(G, U), 2);
    a.recordEvent(G, U, CH, 'spam', 'delete'); a.recordEvent(G, U, CH, 'spam', 'delete'); a.recordEvent(G, U, CH, 'caps', 'delete');
    assert.deepStrictEqual(a.stats(G, 0).map((r) => ({ ...r })), [{ rule: 'spam', n: 2 }, { rule: 'caps', n: 1 }]);
});

test('automod has its own log category, kept apart from moderation', () => {
    const db = fresh();
    const logConfig = createLogConfigService(db, createGuildSettingsService(db));
    logConfig.setChannel(G, 'automod', CH);
    assert.strictEqual(logConfig.getChannelId(G, 'automod'), CH);
    assert.strictEqual(logConfig.getChannelId(G, 'moderation'), null);
});
