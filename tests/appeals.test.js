const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createAppealService } = require('../src/services/appealService');
const { createTempBanService } = require('../src/services/tempBanService');
const { createCaseService } = require('../src/services/caseService');

const G = '111111111111111111', U = '222222222222222222', M = '333333333333333333';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };

test('appeal: one pending per user, resolved only once, blacklist works', () => {
    const a = createAppealService(fresh());
    const ap = a.create({ guildId: G, userId: U, message: 'please unban me' });
    assert.strictEqual(a.findPending(G, U).id, ap.id);
    assert.ok(a.resolve(ap.id, 'denied', M));
    assert.ok(!a.resolve(ap.id, 'approved', M), 'a second moderator cannot override');
    assert.strictEqual(a.findPending(G, U), null);
    assert.ok(!a.isBlacklisted(G, U));
    a.blacklist(G, U);
    assert.ok(a.isBlacklisted(G, U));
    assert.throws(() => a.create({ guildId: G, userId: U, message: '' }), TypeError);
    assert.throws(() => a.create({ guildId: G, userId: U, message: 'x'.repeat(1001) }), TypeError);
});

test('temp bans: due after expiry, cleared, rescheduled', () => {
    const t = createTempBanService(fresh());
    t.schedule(G, U, 4, Date.now() - 1000);
    assert.deepStrictEqual(t.due(), [{ guildId: G, userId: U, caseNumber: 4 }]);
    t.schedule(G, U, 5, Date.now() + 60000);
    assert.strictEqual(t.due().length, 0);
    assert.ok(t.clear(G, U));
    assert.ok(!t.clear(G, U));
});

test('cases keep a proof link; only https links are accepted', () => {
    const c = createCaseService(fresh());
    const rec = c.createCase({ guildId: G, type: 'ban', targetId: U, moderatorId: M, reason: 'x', proofUrl: 'https://cdn.example/a.png' });
    assert.strictEqual(c.getCase(G, rec.caseNumber).proofUrl, 'https://cdn.example/a.png');
    assert.throws(() => c.createCase({ guildId: G, type: 'ban', targetId: U, moderatorId: M, proofUrl: 'javascript:alert(1)' }), TypeError);
    assert.strictEqual(c.createCase({ guildId: G, type: 'warn', targetId: U, moderatorId: M }).proofUrl, null);
});
