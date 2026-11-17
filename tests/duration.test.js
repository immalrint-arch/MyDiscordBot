const test = require('node:test');
const assert = require('node:assert');
const { parseDuration, formatDuration } = require('../src/utils/duration');

test('parses single units', () => {
    assert.strictEqual(parseDuration('30s'), 30 * 1000);
    assert.strictEqual(parseDuration('10m'), 10 * 60 * 1000);
    assert.strictEqual(parseDuration('2h'), 2 * 60 * 60 * 1000);
    assert.strictEqual(parseDuration('1d'), 24 * 60 * 60 * 1000);
    assert.strictEqual(parseDuration('1w'), 7 * 24 * 60 * 60 * 1000);
});

test('parses combinations, spaces and capital letters', () => {
    assert.strictEqual(parseDuration('1h30m'), 90 * 60 * 1000);
    assert.strictEqual(parseDuration('1h 30m'), 90 * 60 * 1000);
    assert.strictEqual(parseDuration('1D12H'), 36 * 60 * 60 * 1000);
});

test('rejects invalid input', () => {
    for (const bad of ['', '   ', 'abc', '10', 'm10', '10x', '-5m', '1.5h', '0s', '0m0s', null, undefined, 42]) {
        assert.strictEqual(parseDuration(bad), null, `should reject ${JSON.stringify(bad)}`);
    }
});

test('rejects very long input without hanging', () => {
    assert.strictEqual(parseDuration('1m'.repeat(100)), null);
    assert.strictEqual(parseDuration(' '.repeat(5000) + 'x'), null);
});

test('formats durations in friendly text', () => {
    assert.strictEqual(formatDuration(30 * 1000), '30s');
    assert.strictEqual(formatDuration(90 * 60 * 1000), '1h 30m');
    assert.strictEqual(formatDuration(26 * 60 * 60 * 1000), '1d 2h');
    assert.strictEqual(formatDuration(0), '0s');
    assert.strictEqual(formatDuration(-5), '0s');
});
