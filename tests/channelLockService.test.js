const test = require('node:test');
const assert = require('node:assert');

const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createChannelLockService } = require('../src/services/channelLockService');

const GUILD_A = '111111111111111111';
const GUILD_B = '222222222222222222';
const CHANNEL = '333333333333333333';
const MOD = '444444444444444444';

function freshService() {
    const db = openDatabase(':memory:');
    runMigrations(db, MIGRATIONS_DIR);
    return createChannelLockService(db);
}

test('a lock remembers the previous state and can be cleared', () => {
    const locks = freshService();
    assert.strictEqual(locks.getLock(GUILD_A, CHANNEL), null);

    locks.saveLock({ guildId: GUILD_A, channelId: CHANNEL, previousState: 'allow', lockedBy: MOD });
    const lock = locks.getLock(GUILD_A, CHANNEL);
    assert.strictEqual(lock.previousState, 'allow');
    assert.strictEqual(lock.lockedBy, MOD);

    locks.clearLock(GUILD_A, CHANNEL);
    assert.strictEqual(locks.getLock(GUILD_A, CHANNEL), null);
});

test('locks are isolated per server', () => {
    const locks = freshService();
    locks.saveLock({ guildId: GUILD_A, channelId: CHANNEL, previousState: 'neutral', lockedBy: MOD });
    assert.strictEqual(locks.getLock(GUILD_B, CHANNEL), null);
});

test('saving again replaces the old record', () => {
    const locks = freshService();
    locks.saveLock({ guildId: GUILD_A, channelId: CHANNEL, previousState: 'allow', lockedBy: MOD });
    locks.saveLock({ guildId: GUILD_A, channelId: CHANNEL, previousState: 'neutral', lockedBy: MOD });
    assert.strictEqual(locks.getLock(GUILD_A, CHANNEL).previousState, 'neutral');
});

test('invalid input is rejected', () => {
    const locks = freshService();
    assert.throws(
        () => locks.saveLock({ guildId: GUILD_A, channelId: CHANNEL, previousState: 'maybe', lockedBy: MOD }),
        /Invalid previous state/
    );
    assert.throws(
        () => locks.saveLock({ guildId: 'x', channelId: CHANNEL, previousState: 'allow', lockedBy: MOD }),
        /Invalid Discord ID/
    );
});
