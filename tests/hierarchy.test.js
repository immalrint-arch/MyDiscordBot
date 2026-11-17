const test = require('node:test');
const assert = require('node:assert');
const { checkHierarchy } = require('../src/moderation/hierarchy');

const OWNER = '900000000000000001';
const MOD = '900000000000000002';
const TARGET = '900000000000000003';
const BOT = '900000000000000004';

// Builds a situation. Positions: higher number = more powerful role.
function situation({ modPos = 10, targetPos = 5, botPos = 20, moderatorId = MOD, targetId = TARGET, botMustOutrank } = {}) {
    return {
        guildOwnerId: OWNER,
        moderator: { id: moderatorId, highestRolePosition: modPos },
        target: { id: targetId, highestRolePosition: targetPos },
        bot: { id: BOT, highestRolePosition: botPos },
        ...(botMustOutrank === undefined ? {} : { botMustOutrank }),
    };
}

test('allows a normal action: moderator and bot both outrank the target', () => {
    assert.strictEqual(checkHierarchy(situation()), null);
});

test('blocks moderating yourself', () => {
    assert.match(checkHierarchy(situation({ targetId: MOD })), /yourself/);
});

test('blocks moderating the bot', () => {
    assert.match(checkHierarchy(situation({ targetId: BOT })), /myself/);
});

test('blocks moderating the server owner, even by the owner', () => {
    assert.match(checkHierarchy(situation({ targetId: OWNER })), /owner/);
    assert.match(checkHierarchy(situation({ moderatorId: OWNER, targetId: OWNER })), /yourself/);
});

test('blocks a target with an equal role to the moderator', () => {
    assert.match(checkHierarchy(situation({ modPos: 5, targetPos: 5 })), /equal to or above/);
});

test('blocks a target with a higher role than the moderator', () => {
    assert.match(checkHierarchy(situation({ modPos: 5, targetPos: 9 })), /equal to or above/);
});

test('the server owner may moderate anyone, whatever the roles', () => {
    assert.strictEqual(checkHierarchy(situation({ moderatorId: OWNER, modPos: 0, targetPos: 5 })), null);
});

test('blocks when the bot does not outrank the target', () => {
    assert.match(checkHierarchy(situation({ botPos: 5, targetPos: 5 })), /My highest role/);
    assert.match(checkHierarchy(situation({ botPos: 3, targetPos: 5 })), /My highest role/);
});

test('the bot rule can be turned off (used for warnings and notes)', () => {
    assert.strictEqual(checkHierarchy(situation({ botPos: 1, targetPos: 5, botMustOutrank: false })), null);
});

test('someone outside the server (no roles) can be banned by a normal moderator', () => {
    assert.strictEqual(checkHierarchy(situation({ targetPos: -1, botMustOutrank: false })), null);
});

test('the moderator check still applies even when the bot rule is off', () => {
    assert.match(checkHierarchy(situation({ modPos: 5, targetPos: 8, botMustOutrank: false })), /equal to or above/);
});
