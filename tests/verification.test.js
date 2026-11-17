const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { renderCaptcha, randomCode, CHARSET, FONT } = require('../src/verification/captchaImage');
const { createCaptchaSessions } = require('../src/verification/captchaSessions');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createVerificationService } = require('../src/services/verificationService');

const G = '111111111111111111', U = '222222222222222222', R = '333333333333333333';

test('captcha picture is a valid PNG and every letter has a full glyph', () => {
    for (const ch of CHARSET) assert.ok(FONT[ch] && FONT[ch].length === 7 && FONT[ch].every((r) => r.length === 5), `glyph ${ch}`);
    const png = renderCaptcha('K7M2X');
    assert.deepStrictEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    assert.ok(width > 100 && height > 50);
    // the pixel data must inflate to exactly (width*3+1)*height bytes
    const idatStart = png.indexOf('IDAT') + 4;
    const idatLen = png.readUInt32BE(png.indexOf('IDAT') - 4);
    assert.strictEqual(zlib.inflateSync(png.subarray(idatStart, idatStart + idatLen)).length, (width * 3 + 1) * height);
});

test('random codes use only clear characters', () => {
    for (let i = 0; i < 200; i++) assert.match(randomCode(5), /^[ABCDEFGHJKLMNPRSTUVWXYZ2-9]{5}$/);
});

test('sessions: right answer, wrong answer burns the code, lockout, expiry', () => {
    let clock = 1000000;
    let next = 'ABCDE';
    const s = createCaptchaSessions({ now: () => clock, makeCode: () => next });
    assert.deepStrictEqual(s.start(G, U), { code: 'ABCDE' });
    assert.deepStrictEqual(s.answer(G, U, ' abcde ', 3), { ok: true }); // case/space tolerant
    assert.strictEqual(s.answer(G, U, 'ABCDE', 3).reason, 'expired'); // a code works only once

    s.start(G, U);
    let r = s.answer(G, U, 'WRONG', 3);
    assert.deepStrictEqual([r.ok, r.reason, r.attemptsLeft], [false, 'wrong', 2]);
    assert.strictEqual(s.answer(G, U, 'ABCDE', 3).reason, 'expired', 'wrong answer destroys the code');
    s.start(G, U); s.answer(G, U, 'X', 3);
    s.start(G, U); r = s.answer(G, U, 'X', 3);
    assert.strictEqual(r.reason, 'locked');
    assert.strictEqual(s.start(G, U).error, 'locked');
    clock += 11 * 60000;
    assert.ok(s.start(G, U).code);

    clock += 6 * 60000; // the code expires after 5 minutes
    assert.strictEqual(s.answer(G, U, 'ABCDE', 3).reason, 'expired');
});

test('sessions: "new code" is limited', () => {
    const s = createCaptchaSessions({ now: () => 1000, makeCode: () => 'ABCDE' });
    for (let i = 0; i < 5; i++) assert.ok(s.start(G, U, { isRefresh: true }).code);
    assert.strictEqual(s.start(G, U, { isRefresh: true }).error, 'refresh-limit');
});

test('verification settings', () => {
    const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR);
    const v = createVerificationService(db);
    assert.strictEqual(v.getConfig(G).enabled, false);
    v.setVerifiedRole(G, R); v.setEnabled(G, true); v.setMaxAttempts(G, 5);
    assert.deepStrictEqual(v.getConfig(G), { guildId: G, enabled: true, verifiedRoleId: R, unverifiedRoleId: null, maxAttempts: 5 });
    assert.throws(() => v.setMaxAttempts(G, 0), TypeError);
    assert.throws(() => v.setVerifiedRole(G, 'abc'), TypeError);
});
