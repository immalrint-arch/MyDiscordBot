const test = require('node:test');
const assert = require('node:assert');
const { cleanReason, cleanText, truncate, MAX_REASON_LENGTH } = require('../src/utils/text');
const { formatCaseLine } = require('../src/utils/format');

test('cleanReason trims, squeezes spaces and removes control characters', () => {
    assert.strictEqual(cleanReason('  spamming   in\n#general\t '), 'spamming in #general');
    assert.strictEqual(cleanReason('bad\u0000text\u0007'), 'bad text');
});

test('cleanReason returns null for empty or non-text input', () => {
    assert.strictEqual(cleanReason(''), null);
    assert.strictEqual(cleanReason('   \n  '), null);
    assert.strictEqual(cleanReason(null), null);
    assert.strictEqual(cleanReason(undefined), null);
    assert.strictEqual(cleanReason(42), null);
});

test('cleanReason never returns more than 512 characters', () => {
    const result = cleanReason('a'.repeat(2000));
    assert.strictEqual(result.length, MAX_REASON_LENGTH);
    assert.ok(result.endsWith('…'));
});

test('cleanText and truncate respect their limits', () => {
    assert.strictEqual(cleanText('Hello world', 5), 'Hell…');
    assert.strictEqual(truncate('short', 10), 'short');
    assert.strictEqual(truncate(undefined, 10), '');
});

test('formatCaseLine shows pardoned warnings and shortens long reasons', () => {
    const base = {
        caseNumber: 7,
        type: 'warn',
        reason: 'x'.repeat(200),
        active: false,
        createdAt: '2026-11-07T12:00:00.000Z',
    };
    const line = formatCaseLine(base);
    assert.match(line, /#7/);
    assert.match(line, /Warning/);
    assert.match(line, /pardoned/);
    assert.ok(line.length < 200, 'long reasons must be shortened');
    assert.doesNotMatch(formatCaseLine({ ...base, active: true }), /pardoned/);
    assert.match(formatCaseLine({ ...base, type: 'ban', reason: null }), /No reason provided/);
});
