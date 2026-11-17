const test = require('node:test');
const assert = require('node:assert');
const f = require('../src/logging/textFormat');

test('stamp makes Discord timestamps in seconds', () => {
    assert.strictEqual(f.stamp(new Date('2026-11-04T13:01:00Z'), 'f'), '<t:1793797260:f>');
    assert.strictEqual(f.stamp(1793797260000, 'R'), '<t:1793797260:R>');
});

test('dateWithAgo shows the date and the relative time', () => {
    assert.match(f.dateWithAgo(1793797260000), /^<t:1793797260:D> \(<t:1793797260:R>\)$/);
});

test('buildDescription lays out headline, lines and small footer', () => {
    const text = f.buildDescription({ headline: 'Head', lines: [f.line('A', 'b')], footer: ['one', 'two'] });
    assert.strictEqual(text, 'Head\n\n**A:** b\n\n-# one\n-# two');
    assert.strictEqual(f.buildDescription({ headline: 'Only' }), 'Only');
});

test('buildDescription never exceeds Discord\'s embed limit', () => {
    assert.ok(f.buildDescription({ headline: 'x'.repeat(9000) }).length <= 4000);
});

test('memberFooter shows name, username, time and ID', () => {
    const [first, second] = f.memberFooter({ displayName: 'Minty', username: 'minty_sugar', id: '123', when: new Date(0) });
    assert.match(first, /Member: Minty \(@minty_sugar\) \| Time: <t:0:f>/);
    assert.strictEqual(second, 'Member `123`');
    assert.match(f.memberFooter({ displayName: 'same', username: 'same', id: '1' })[0], /Member: @same/);
});

test('isNewAccount flags accounts younger than a day', () => {
    const now = 10 * f.DAY_MS;
    assert.strictEqual(f.isNewAccount(now - 3600 * 1000, now), true);
    assert.strictEqual(f.isNewAccount(now - 2 * f.DAY_MS, now), false);
});

test('permission and channel type names are made readable', () => {
    assert.strictEqual(f.readablePermission('ManageMessages'), 'Manage Messages');
    assert.strictEqual(f.permissionList(['SendMessages', 'ViewChannel']), 'Send Messages, View Channel');
    assert.strictEqual(f.permissionList([]), 'None');
    assert.strictEqual(f.readableChannelType('GuildText'), 'Text');
    assert.strictEqual(f.readableChannelType('GuildAnnouncement'), 'Announcement');
    assert.strictEqual(f.readableChannelType(undefined), 'Unknown');
});

test('colour text is hex or "Default"', () => {
    assert.strictEqual(f.colorText(0), 'Default (no colour)');
    assert.strictEqual(f.colorText(0xff0000), '#ff0000');
    assert.strictEqual(f.colorText(0x0000ff), '#0000ff');
});

test('diffLists says what was added and removed', () => {
    assert.deepStrictEqual(f.diffLists(['a', 'b'], ['b', 'c']), { added: ['c'], removed: ['a'] });
    assert.deepStrictEqual(f.diffLists([], []), { added: [], removed: [] });
});

test('quoteBlock quotes every line and handles empty text', () => {
    assert.strictEqual(f.quoteBlock('hi\nthere'), '> hi\n> there');
    assert.strictEqual(f.quoteBlock(''), '*(no text)*');
    assert.ok(f.quoteBlock('x'.repeat(5000)).length <= 1100);
});
