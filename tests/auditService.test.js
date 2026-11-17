const test = require('node:test');
const assert = require('node:assert');
const { createAuditService } = require('../src/services/auditService');

const silentLogger = { warn() {}, info() {}, error() {} };
const NOW = 1_000_000;
const TARGET = '111111111111111111';

// A fake guild whose audit log returns different entries on each call.
function guildWith(batches, { canView = true, throws = false } = {}) {
    let call = 0;
    const guild = {
        id: '222222222222222222',
        members: { me: { permissions: { has: () => canView } } },
        fetchAuditLogs: async () => {
            guild.calls = ++call;
            if (throws) throw new Error('boom');
            const entries = batches[Math.min(call - 1, batches.length - 1)];
            return { entries: new Map(entries.map((e, i) => [i, e])) };
        },
    };
    return guild;
}

const entry = (over = {}) => ({ targetId: TARGET, createdTimestamp: NOW - 1000, executorId: 'x', ...over });
const service = () => createAuditService({ logger: silentLogger, sleep: async () => {}, now: () => NOW });

test('finds a recent entry about the right target', async () => {
    const found = await service().findEntry(guildWith([[entry()]]), 22, { targetId: TARGET });
    assert.strictEqual(found.executorId, 'x');
});

test('ignores entries about another target or that are too old', async () => {
    const guild = guildWith([[entry({ targetId: '999999999999999999' }), entry({ createdTimestamp: NOW - 60000 })]]);
    assert.strictEqual(await service().findEntry(guild, 22, { targetId: TARGET, attempts: 1 }), null);
});

test('retries because audit entries can show up late', async () => {
    const guild = guildWith([[], [], [entry()]]);
    const found = await service().findEntry(guild, 22, { targetId: TARGET, attempts: 3 });
    assert.ok(found);
    assert.strictEqual(guild.calls, 3);
});

test('gives up after the allowed attempts and returns null', async () => {
    const guild = guildWith([[]]);
    assert.strictEqual(await service().findEntry(guild, 22, { targetId: TARGET, attempts: 2 }), null);
    assert.strictEqual(guild.calls, 2);
});

test('returns null without asking Discord when the bot cannot view the audit log', async () => {
    const guild = guildWith([[entry()]], { canView: false });
    assert.strictEqual(await service().findEntry(guild, 22, { targetId: TARGET }), null);
    assert.strictEqual(guild.calls, undefined);
});

test('an API error never throws', async () => {
    assert.strictEqual(await service().findEntry(guildWith([[]], { throws: true }), 22, { targetId: TARGET }), null);
});
