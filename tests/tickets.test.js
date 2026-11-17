const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createTicketService } = require('../src/services/ticketService');
const { buildOverwrites, isStaff, cleanChannelName, ticketChannelName } = require('../src/tickets/permissions');
const { buildTranscriptHtml } = require('../src/tickets/transcript');

const G = '111111111111111111', U = '222222222222222222', U2 = '333333333333333333', C1 = '444444444444444441', C2 = '444444444444444442', R = '555555555555555555';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return createTicketService(db); };

test('tickets are OFF by default; settings validate', () => {
    const t = fresh();
    assert.strictEqual(t.getConfig(G).enabled, false);
    t.setEnabled(G, true); t.setCategory(G, C1); t.setMaxOpen(G, 3);
    assert.ok(t.addStaffRole(G, R)); assert.ok(!t.addStaffRole(G, R));
    const c = t.getConfig(G);
    assert.deepStrictEqual([c.enabled, c.categoryId, c.maxOpenPerUser, c.staffRoleIds], [true, C1, 3, [R]]);
    assert.throws(() => t.setMaxOpen(G, 0), TypeError);
    assert.throws(() => t.setCategory(G, 'abc'), TypeError);
});

test('ticket numbering, per-user count, claim/close/rate are atomic', () => {
    const t = fresh();
    const a = t.createTicket({ guildId: G, channelId: C1, openerId: U, subject: 'help' });
    const b = t.createTicket({ guildId: G, channelId: C2, openerId: U2, subject: 'more' });
    assert.deepStrictEqual([a.number, b.number], [1, 2]);
    assert.strictEqual(t.countOpenFor(G, U), 1);
    assert.strictEqual(t.getByChannel(C2).openerId, U2);

    assert.ok(t.claim(a.id, R));
    assert.ok(!t.claim(a.id, U2), 'second claim must fail');
    assert.ok(!t.unclaim(a.id, U2), 'only the claimer can release');
    assert.ok(t.unclaim(a.id, R));

    assert.ok(t.close(a.id, R, 'done'));
    assert.ok(!t.close(a.id, R, 'again'), 'cannot close twice');
    assert.strictEqual(t.countOpenFor(G, U), 0);
    assert.ok(!t.claim(a.id, R), 'cannot claim a closed ticket');

    assert.ok(!t.rate(b.id, 5), 'cannot rate an open ticket');
    assert.ok(t.rate(a.id, 4));
    assert.ok(!t.rate(a.id, 5), 'only one rating');
    assert.throws(() => t.rate(a.id, 9), TypeError);
    assert.strictEqual(t.getById(a.id).rating, 4);
    assert.strictEqual(t.listOpen(G).length, 1);
});

test('channel overwrites hide the channel from everyone else', () => {
    const o = buildOverwrites({ everyoneId: G, openerId: U, staffRoleIds: [R], botId: U2 });
    assert.deepStrictEqual(o.map((x) => x.id), [G, U2, U, R]);
    assert.ok(o[0].deny.length === 1 && !o[0].allow);
});

test('staff check, channel names', () => {
    assert.ok(isStaff({ roleIds: [R], isAdministrator: false }, [R]));
    assert.ok(isStaff({ roleIds: [], isAdministrator: true }, [R]));
    assert.ok(!isStaff({ roleIds: ['x'], isAdministrator: false }, [R]));
    assert.strictEqual(cleanChannelName('Hello World!! <@123>'), 'hello-world-123');
    assert.strictEqual(cleanChannelName('???'), 'ticket');
    assert.strictEqual(ticketChannelName(7), 'ticket-0007');
});

test('transcript escapes every piece of user text and unsafe links', () => {
    const html = buildTranscriptHtml({
        guildName: '<b>Guild</b>', ticket: { number: 3, subject: '<script>alert(1)</script>', openerId: U },
        messages: [{ authorName: '<img src=x onerror=alert(1)>', authorId: U, avatarUrl: 'javascript:alert(1)', createdAt: 'now', content: '<script>x</script> & "q"', attachments: [{ name: '<n>', url: 'javascript:alert(2)' }], embedCount: 1 }],
    });
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('javascript:'));
    assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot;'));
});
