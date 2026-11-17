const test = require('node:test');
const assert = require('node:assert');
const { buildThresholds } = require('../src/antinuke/rules');
const { createDetector } = require('../src/antinuke/detector');
const { classifyActor, assessSeverity, decideResponse } = require('../src/antinuke/policy');

test('default limits: balanced, relaxed, strict, safe, trusted', () => {
    assert.strictEqual(buildThresholds().channelDelete.threshold, 3);
    assert.strictEqual(buildThresholds({ sensitivity: 'relaxed' }).channelDelete.threshold, 5); // ceil(4.5)
    assert.strictEqual(buildThresholds({ sensitivity: 'strict' }).channelDelete.threshold, 2);
    assert.strictEqual(buildThresholds({ safe: true }).channelDelete.threshold, 2); // never below 2
    assert.strictEqual(buildThresholds({ trusted: true }).channelDelete.threshold, 9);
    assert.strictEqual(buildThresholds({ trusted: true }).botAdd.threshold, 1); // single rules untouched
});

test('custom limits are used as typed, regardless of sensitivity', () => {
    const t = buildThresholds({ overrides: { channelDelete: { threshold: 7, windowSec: 20 } }, sensitivity: 'strict' });
    assert.deepStrictEqual(t.channelDelete, { threshold: 7, windowSec: 20 });
});

test('detector counts only inside the window', () => {
    let clock = 100000;
    const d = createDetector({ now: () => clock });
    d.record('g', 'a', 'channelDelete'); clock += 5000;
    d.record('g', 'a', 'channelDelete'); clock += 6000; // first one is now 11 s old
    d.record('g', 'a', 'channelDelete');
    const t = { channelDelete: { threshold: 3, windowSec: 10 } };
    assert.strictEqual(d.evaluate('g', 'a', t).length, 0);
    d.record('g', 'a', 'channelDelete');
    assert.strictEqual(d.evaluate('g', 'a', t).length, 1);
    assert.strictEqual(d.evaluate('g', 'other', t).length, 0); // per person
    d.clearActor('g', 'a');
    assert.strictEqual(d.count('g', 'a', 'channelDelete', 10000), 0);
});

test('actor classes', () => {
    const base = { ownerId: 'o', selfId: 's', trustedUserIds: ['t'], trustedRoleIds: ['r'] };
    assert.strictEqual(classifyActor({ ...base, actorId: null }), 'unknown');
    assert.strictEqual(classifyActor({ ...base, actorId: 's' }), 'self');
    assert.strictEqual(classifyActor({ ...base, actorId: 'o' }), 'owner');
    assert.strictEqual(classifyActor({ ...base, actorId: 't' }), 'trusted');
    assert.strictEqual(classifyActor({ ...base, actorId: 'x', memberRoleIds: ['r'] }), 'trusted');
    assert.strictEqual(classifyActor({ ...base, actorId: 'x', isBot: true }), 'bot');
    assert.strictEqual(classifyActor({ ...base, actorId: 'x' }), 'member');
});

test('severity and response never contain on weak or uncertain evidence', () => {
    const one = [{ rule: 'channelDelete', count: 3, threshold: 3 }];
    const triple = [{ rule: 'channelDelete', count: 9, threshold: 3 }];
    const two = [...one, { rule: 'roleDelete', count: 3, threshold: 3 }];
    const single = [{ rule: 'botAdd', count: 1, threshold: 1 }];
    assert.strictEqual(assessSeverity(single), 'low');
    assert.strictEqual(assessSeverity(one), 'medium');
    assert.strictEqual(assessSeverity(triple), 'high');
    assert.strictEqual(assessSeverity(two), 'high');

    assert.strictEqual(decideResponse({ actorClass: 'member', severity: 'medium', mode: 'contain' }), 'alert');
    assert.strictEqual(decideResponse({ actorClass: 'member', severity: 'high', mode: 'alert' }), 'alert');
    assert.strictEqual(decideResponse({ actorClass: 'member', severity: 'high', mode: 'contain' }), 'contain');
    assert.strictEqual(decideResponse({ actorClass: 'member', severity: 'high', mode: 'alert', safe: true }), 'contain');
    assert.strictEqual(decideResponse({ actorClass: 'unknown', severity: 'high', mode: 'contain' }), 'alert');
    assert.strictEqual(decideResponse({ actorClass: 'trusted', severity: 'high', mode: 'contain' }), 'alert');
    assert.strictEqual(decideResponse({ actorClass: 'owner', severity: 'high', mode: 'contain' }), 'ignore');
});
