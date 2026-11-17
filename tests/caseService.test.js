const test = require('node:test');
const assert = require('node:assert');

const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createCaseService } = require('../src/services/caseService');

const GUILD_A = '111111111111111111';
const GUILD_B = '222222222222222222';
const MOD = '333333333333333333';
const USER_1 = '444444444444444444';
const USER_2 = '555555555555555555';

function freshService() {
    const db = openDatabase(':memory:');
    runMigrations(db, MIGRATIONS_DIR);
    return { db, cases: createCaseService(db) };
}

const warn = (guildId, targetId = USER_1, reason = 'spam') => ({
    guildId,
    type: 'warn',
    targetId,
    moderatorId: MOD,
    reason,
});

test('case numbers count up separately for each server', () => {
    const { cases } = freshService();
    assert.strictEqual(cases.createCase(warn(GUILD_A)).caseNumber, 1);
    assert.strictEqual(cases.createCase(warn(GUILD_A)).caseNumber, 2);
    assert.strictEqual(cases.createCase(warn(GUILD_B)).caseNumber, 1);
    assert.strictEqual(cases.createCase(warn(GUILD_A)).caseNumber, 3);
});

test('a created case can be read back with all its details', () => {
    const { cases } = freshService();
    const made = cases.createCase({
        guildId: GUILD_A,
        type: 'timeout',
        targetId: USER_1,
        moderatorId: MOD,
        reason: 'too loud',
        durationMs: 600000,
    });
    const found = cases.getCase(GUILD_A, made.caseNumber);
    assert.strictEqual(found.type, 'timeout');
    assert.strictEqual(found.targetId, USER_1);
    assert.strictEqual(found.moderatorId, MOD);
    assert.strictEqual(found.reason, 'too loud');
    assert.strictEqual(found.durationMs, 600000);
    assert.strictEqual(found.active, true);
    assert.match(found.createdAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
});

test('a case in one server is invisible from another server', () => {
    const { cases } = freshService();
    cases.createCase(warn(GUILD_A));
    assert.strictEqual(cases.getCase(GUILD_B, 1), null);
    assert.strictEqual(cases.countCases(GUILD_B), 0);
});

test('a missing reason is stored as null', () => {
    const { cases } = freshService();
    const made = cases.createCase({ guildId: GUILD_A, type: 'kick', targetId: USER_1, moderatorId: MOD });
    assert.strictEqual(made.reason, null);
    assert.strictEqual(made.durationMs, null);
});

test('listCases is newest first, filters by user, and pages correctly', () => {
    const { cases } = freshService();
    for (let i = 0; i < 12; i++) cases.createCase(warn(GUILD_A, USER_1, `reason ${i}`));
    cases.createCase(warn(GUILD_A, USER_2, 'other person'));

    assert.strictEqual(cases.countCases(GUILD_A, { targetId: USER_1 }), 12);
    assert.strictEqual(cases.countCases(GUILD_A), 13);

    const firstPage = cases.listCases(GUILD_A, { targetId: USER_1, limit: 10, offset: 0 });
    assert.strictEqual(firstPage.length, 10);
    assert.strictEqual(firstPage[0].reason, 'reason 11'); // newest first

    const secondPage = cases.listCases(GUILD_A, { targetId: USER_1, limit: 10, offset: 10 });
    assert.strictEqual(secondPage.length, 2);
    assert.ok(secondPage.every((c) => c.targetId === USER_1));
});

test('active warnings hide pardoned ones, and pardon only works once', () => {
    const { cases } = freshService();
    cases.createCase(warn(GUILD_A)); // #1
    cases.createCase(warn(GUILD_A)); // #2
    cases.createCase({ guildId: GUILD_A, type: 'kick', targetId: USER_1, moderatorId: MOD }); // #3

    assert.strictEqual(cases.listActiveWarnings(GUILD_A, USER_1).length, 2);
    assert.strictEqual(cases.deactivateWarning(GUILD_A, 1), true);
    assert.strictEqual(cases.deactivateWarning(GUILD_A, 1), false); // already pardoned
    assert.strictEqual(cases.deactivateWarning(GUILD_A, 3), false); // a kick is not a warning
    assert.strictEqual(cases.deactivateWarning(GUILD_A, 99), false); // does not exist
    assert.strictEqual(cases.listActiveWarnings(GUILD_A, USER_1).length, 1);
    assert.strictEqual(cases.getCase(GUILD_A, 1).active, false); // still in the history
});

test('a pardon in one server cannot touch another server', () => {
    const { cases } = freshService();
    cases.createCase(warn(GUILD_A));
    cases.createCase(warn(GUILD_B));
    assert.strictEqual(cases.deactivateWarning(GUILD_B, 1), true);
    assert.strictEqual(cases.getCase(GUILD_A, 1).active, true);
});

test('updateReason changes only the requested case', () => {
    const { cases } = freshService();
    cases.createCase(warn(GUILD_A, USER_1, 'old'));
    cases.createCase(warn(GUILD_A, USER_1, 'other'));
    assert.strictEqual(cases.updateReason(GUILD_A, 1, 'new'), true);
    assert.strictEqual(cases.getCase(GUILD_A, 1).reason, 'new');
    assert.strictEqual(cases.getCase(GUILD_A, 2).reason, 'other');
    assert.strictEqual(cases.updateReason(GUILD_A, 50, 'nope'), false);
});

test('invalid input is rejected and nothing is saved', () => {
    const { cases } = freshService();
    assert.throws(() => cases.createCase({ ...warn(GUILD_A), type: 'explode' }), /Unknown case type/);
    assert.throws(() => cases.createCase({ ...warn(GUILD_A), targetId: 'abc' }), /Invalid Discord ID/);
    assert.throws(() => cases.createCase({ ...warn(GUILD_A), guildId: "1'; DROP TABLE cases; --" }), /Invalid Discord ID/);
    assert.throws(() => cases.createCase({ ...warn(GUILD_A), reason: 'x'.repeat(513) }), /Invalid reason/);
    assert.throws(() => cases.createCase({ ...warn(GUILD_A), durationMs: -5 }), /Invalid duration/);
    assert.throws(() => cases.createCase({ ...warn(GUILD_A), durationMs: 1.5 }), /Invalid duration/);
    assert.strictEqual(cases.countCases(GUILD_A), 0);
});

test('a reason with SQL-like text is stored as plain text', () => {
    const { cases } = freshService();
    const tricky = "'; DROP TABLE cases; --";
    cases.createCase(warn(GUILD_A, USER_1, tricky));
    assert.strictEqual(cases.getCase(GUILD_A, 1).reason, tricky);
});
