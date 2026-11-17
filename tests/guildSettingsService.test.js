const test = require('node:test');
const assert = require('node:assert');

const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createGuildSettingsService } = require('../src/services/guildSettingsService');

const GUILD_A = '111111111111111111';
const GUILD_B = '222222222222222222';
const CHANNEL = '333333333333333333';

// Every test gets its own fresh, empty database.
function freshService() {
    const db = openDatabase(':memory:');
    runMigrations(db, MIGRATIONS_DIR);
    return { db, service: createGuildSettingsService(db) };
}

test('a new server gets default settings', () => {
    const { service } = freshService();
    assert.deepStrictEqual(service.getSettings(GUILD_A), {
        guildId: GUILD_A,
        logChannelId: null,
        dmOnAction: true,
        appealChannelId: null,
    });
});

test('ensureGuild can be called many times without duplicating rows', () => {
    const { db, service } = freshService();
    service.ensureGuild(GUILD_A);
    service.ensureGuild(GUILD_A);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM guilds').get().n, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM guild_settings').get().n, 1);
});

test('a setting can be saved, read back and cleared', () => {
    const { service } = freshService();
    service.updateSetting(GUILD_A, 'logChannelId', CHANNEL);
    assert.strictEqual(service.getSettings(GUILD_A).logChannelId, CHANNEL);
    service.updateSetting(GUILD_A, 'logChannelId', null);
    assert.strictEqual(service.getSettings(GUILD_A).logChannelId, null);
});

test('the private-message setting can be switched off and on', () => {
    const { service } = freshService();
    service.updateSetting(GUILD_A, 'dmOnAction', false);
    assert.strictEqual(service.getSettings(GUILD_A).dmOnAction, false);
    service.updateSetting(GUILD_A, 'dmOnAction', true);
    assert.strictEqual(service.getSettings(GUILD_A).dmOnAction, true);
});

test('servers have isolated settings', () => {
    const { service } = freshService();
    service.updateSetting(GUILD_A, 'logChannelId', CHANNEL);
    service.updateSetting(GUILD_A, 'dmOnAction', false);
    assert.strictEqual(service.getSettings(GUILD_B).logChannelId, null);
    assert.strictEqual(service.getSettings(GUILD_B).dmOnAction, true);
});

test('unknown setting names are rejected', () => {
    const { service } = freshService();
    assert.throws(() => service.updateSetting(GUILD_A, 'guild_id', CHANNEL), /Unknown setting/);
    assert.throws(() => service.updateSetting(GUILD_A, '__proto__', CHANNEL), /Unknown setting/);
});

test('invalid values are rejected and nothing is saved', () => {
    const { service } = freshService();
    assert.throws(() => service.updateSetting(GUILD_A, 'logChannelId', 'abc'), /Invalid value/);
    assert.throws(() => service.updateSetting(GUILD_A, 'logChannelId', 12345), /Invalid value/);
    assert.throws(
        () => service.updateSetting(GUILD_A, 'logChannelId', "1'; DROP TABLE guilds; --"),
        /Invalid value/
    );
    assert.throws(() => service.updateSetting(GUILD_A, 'dmOnAction', 'yes'), /Invalid value/);
    assert.strictEqual(service.getSettings(GUILD_A).logChannelId, null);
    assert.strictEqual(service.getSettings(GUILD_A).dmOnAction, true);
});

test('invalid guild IDs are rejected', () => {
    const { service } = freshService();
    assert.throws(() => service.ensureGuild('not-an-id'), /Invalid guild ID/);
    assert.throws(() => service.getSettings(undefined), /Invalid guild ID/);
});
