const test = require('node:test');
const assert = require('node:assert');
const { createSuppressionService } = require('../src/services/suppressionService');

test('a mark suppresses the matching event only', () => {
    const s = createSuppressionService();
    s.mark('g1', 'ban', 'u1');
    assert.strictEqual(s.isSuppressed('g1', 'ban', 'u1'), true);
    assert.strictEqual(s.isSuppressed('g1', 'ban', 'u2'), false); // other user
    assert.strictEqual(s.isSuppressed('g1', 'leave', 'u1'), false); // other kind
    assert.strictEqual(s.isSuppressed('g2', 'ban', 'u1'), false); // other server
});

test('marks expire', () => {
    let time = 1000;
    const s = createSuppressionService({ now: () => time, ttlMs: 15000 });
    s.mark('g1', 'ban', 'u1');
    time += 14999;
    assert.strictEqual(s.isSuppressed('g1', 'ban', 'u1'), true);
    time += 2;
    assert.strictEqual(s.isSuppressed('g1', 'ban', 'u1'), false);
});
