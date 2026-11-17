const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createGuildSettingsService } = require('../src/services/guildSettingsService');
const { createLogConfigService } = require('../src/services/logConfigService');

const GUILD_A = '111111111111111111';
const GUILD_B = '222222222222222222';
const CH_1 = '333333333333333333';
const CH_2 = '444444444444444444';
const ROLE = '555555555555555555';
const USER = '666666666666666666';

function fresh() {
    const db = openDatabase(':memory:');
    runMigrations(db, MIGRATIONS_DIR);
    const guildSettings = createGuildSettingsService(db);
    return { guildSettings, config: createLogConfigService(db, guildSettings) };
}

test('a category channel can be set, replaced, and cleared', () => {
    const { config } = fresh();
    config.setChannel(GUILD_A, 'members', CH_1);
    assert.strictEqual(config.getChannelId(GUILD_A, 'members'), CH_1);
    config.setChannel(GUILD_A, 'members', CH_2); // replaces, does not duplicate
    assert.strictEqual(config.getChannelId(GUILD_A, 'members'), CH_2);
    assert.strictEqual(config.clearChannel(GUILD_A, 'members'), true);
    assert.strictEqual(config.clearChannel(GUILD_A, 'members'), false);
    assert.strictEqual(config.getChannelId(GUILD_A, 'members'), null);
});

test('without its own channel, a category uses the general log channel', () => {
    const { guildSettings, config } = fresh();
    guildSettings.updateSetting(GUILD_A, 'logChannelId', CH_1);
    assert.strictEqual(config.getChannelId(GUILD_A, 'voice'), CH_1);
    config.setChannel(GUILD_A, 'voice', CH_2);
    assert.strictEqual(config.getChannelId(GUILD_A, 'voice'), CH_2);
});

test('servers are isolated from each other', () => {
    const { config } = fresh();
    config.setChannel(GUILD_A, 'roles', CH_1);
    config.addIgnore(GUILD_A, 'user', USER);
    assert.strictEqual(config.getChannelId(GUILD_B, 'roles'), null);
    assert.strictEqual(config.isIgnored({ guildId: GUILD_B, userId: USER }), false);
    assert.deepStrictEqual(config.listChannels(GUILD_B), {});
});

test('ignore lists work for channels, roles and users', () => {
    const { config } = fresh();
    assert.strictEqual(config.addIgnore(GUILD_A, 'channel', CH_1), true);
    assert.strictEqual(config.addIgnore(GUILD_A, 'channel', CH_1), false); // already there
    config.addIgnore(GUILD_A, 'role', ROLE);
    config.addIgnore(GUILD_A, 'user', USER);

    assert.strictEqual(config.isIgnored({ guildId: GUILD_A, channelId: CH_1 }), true);
    assert.strictEqual(config.isIgnored({ guildId: GUILD_A, channelId: CH_2 }), false);
    assert.strictEqual(config.isIgnored({ guildId: GUILD_A, roleIds: ['999999999999999999', ROLE] }), true);
    assert.strictEqual(config.isIgnored({ guildId: GUILD_A, userId: USER }), true);
    assert.strictEqual(config.listIgnores(GUILD_A).length, 3);

    assert.strictEqual(config.removeIgnore(GUILD_A, 'user', USER), true);
    assert.strictEqual(config.isIgnored({ guildId: GUILD_A, userId: USER }), false);
});

test('invalid categories, kinds and IDs are rejected', () => {
    const { config } = fresh();
    assert.throws(() => config.setChannel(GUILD_A, 'bananas', CH_1), /Unknown log category/);
    assert.throws(() => config.setChannel(GUILD_A, 'members', 'abc'), /Invalid Discord ID/);
    assert.throws(() => config.addIgnore(GUILD_A, 'planet', CH_1), /Unknown ignore type/);
    assert.throws(() => config.addIgnore(GUILD_A, 'user', "1'; DROP TABLE log_ignores; --"), /Invalid Discord ID/);
    assert.throws(() => config.getChannelId(GUILD_A, 'x'), /Unknown log category/);
});
