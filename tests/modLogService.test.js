const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createGuildSettingsService } = require('../src/services/guildSettingsService');
const { createLogConfigService } = require('../src/services/logConfigService');
const { createLogService } = require('../src/services/logService');
const { createModLogService } = require('../src/services/modLogService');

const GUILD = '111111111111111111';
const CHANNEL = '222222222222222222';
const OTHER_CHANNEL = '333333333333333333';
const USER = '444444444444444444';

const silentLogger = { warn() {}, info() {}, error() {} };

function setup() {
    const db = openDatabase(':memory:');
    runMigrations(db, MIGRATIONS_DIR);
    const guildSettings = createGuildSettingsService(db);
    const logConfig = createLogConfigService(db, guildSettings);
    const logs = createLogService({ logConfig, logger: silentLogger });
    return { guildSettings, logConfig, logs };
}

// A fake "guild" that records what would have been sent, per channel id.
function fakeGuild(sent, { failSend = false, missing = false } = {}) {
    return {
        id: GUILD,
        channels: {
            fetch: async (id) =>
                missing
                    ? null
                    : {
                          isTextBased: () => true,
                          send: async (payload) => {
                              if (failSend) throw new Error('Missing Access');
                              sent.push({ id, payload });
                          },
                      },
        },
    };
}

test('sends to the category channel and never allows pings', async () => {
    const { logConfig, logs } = setup();
    logConfig.setChannel(GUILD, 'messages', CHANNEL);
    const sent = [];
    assert.strictEqual(await logs.send(fakeGuild(sent), 'messages', { content: '@everyone hi' }), true);
    assert.strictEqual(sent[0].id, CHANNEL);
    assert.deepStrictEqual(sent[0].payload.allowedMentions, { parse: [] });
});

test('falls back to the general log channel when a category has none', async () => {
    const { guildSettings, logs } = setup();
    guildSettings.updateSetting(GUILD, 'logChannelId', OTHER_CHANNEL);
    const sent = [];
    assert.strictEqual(await logs.send(fakeGuild(sent), 'voice', { content: 'x' }), true);
    assert.strictEqual(sent[0].id, OTHER_CHANNEL);
});

test('does nothing when no channel is configured anywhere', async () => {
    const { logs } = setup();
    const sent = [];
    assert.strictEqual(await logs.send(fakeGuild(sent), 'voice', { content: 'x' }), false);
    assert.strictEqual(sent.length, 0);
});

test('ignored users, channels and roles are never logged', async () => {
    const { logConfig, logs } = setup();
    logConfig.setChannel(GUILD, 'messages', CHANNEL);
    logConfig.addIgnore(GUILD, 'user', USER);
    const sent = [];
    assert.strictEqual(await logs.send(fakeGuild(sent), 'messages', { content: 'x' }, { userId: USER }), false);
    assert.strictEqual(await logs.send(fakeGuild(sent), 'messages', { content: 'x' }, { userId: '555555555555555555' }), true);
    assert.strictEqual(sent.length, 1);
});

test('a missing channel or a failing send never throws', async () => {
    const { logConfig, logs } = setup();
    logConfig.setChannel(GUILD, 'messages', CHANNEL);
    assert.strictEqual(await logs.send(fakeGuild([], { missing: true }), 'messages', { content: 'x' }), false);
    assert.strictEqual(await logs.send(fakeGuild([], { failSend: true }), 'messages', { content: 'x' }), false);
});

test('the moderation log uses the moderation category', async () => {
    const { logConfig, logs } = setup();
    logConfig.setChannel(GUILD, 'moderation', CHANNEL);
    logConfig.setChannel(GUILD, 'messages', OTHER_CHANNEL);
    const modLog = createModLogService({ logService: logs });
    const sent = [];
    await modLog.send(fakeGuild(sent), { content: 'case' });
    assert.strictEqual(sent[0].id, CHANNEL);
});
