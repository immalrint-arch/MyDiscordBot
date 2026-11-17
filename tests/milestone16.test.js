const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createFunService, FunServiceError } = require('../src/services/funService');
const rules = require('../src/fun/rules');
const g = require('../src/fun/games');
const data = require('../src/fun/data');
const flow = require('../src/fun/funFlow');

const G = '111111111111111111', CH = '444444444444444441', ROLE = '555555555555555551', U1 = '222222222222222221', U2 = '222222222222222222', U3 = '222222222222222223';
const json = (x) => JSON.stringify(x);
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

// ---------- pure rules ----------
test('dice: parse, limits, rolling', () => {
    assert.deepStrictEqual(rules.parseDice('2d20+3'), { count: 2, sides: 20, mod: 3 }); assert.deepStrictEqual(rules.parseDice('d6'), { count: 1, sides: 6, mod: 0 }); assert.deepStrictEqual(rules.parseDice(' 3D8 - 2 '), { count: 3, sides: 8, mod: -2 });
    for (const bad of ['0d6', '21d6', 'd1', 'd1001', 'abc', '2d', '2d6+', '']) assert.strictEqual(rules.parseDice(bad), null, bad);
    assert.deepStrictEqual(rules.rollDice({ count: 3, sides: 6, mod: 1 }, seq(0, 0.5, 0.999)), { rolls: [1, 4, 6], total: 12 });
});
test('choose: separators, duplicates, limits', () => {
    assert.deepStrictEqual(rules.parseChoices('pizza, burgers ,Pizza,tacos').options, ['pizza', 'burgers', 'tacos']); assert.deepStrictEqual(rules.parseChoices('a b | c, d').options, ['a b', 'c, d']);
    assert.ok(rules.parseChoices('only').problem); assert.ok(rules.parseChoices(Array.from({ length: 21 }, (_, i) => `o${i}`).join(',')).problem);
});
test('ship and rate are stable and in range', () => {
    assert.strictEqual(rules.shipPercent(U1, U2), rules.shipPercent(U2, U1)); for (let i = 0; i < 50; i++) { const p = rules.shipPercent(`${i}`, `x${i}`); assert.ok(p >= 0 && p <= 100); }
    assert.strictEqual(rules.ratePercent('Pizza'), rules.ratePercent(' pizza ')); assert.ok(rules.ratePercent('x') >= 0 && rules.ratePercent('x') <= 10);
    assert.ok(rules.shipLabel(100).length && rules.shipLabel(0).length); assert.strictEqual(rules.bar(50), '▰▰▰▰▰▱▱▱▱▱');
});
test('birthday rules: validation, leap day, time zones, countdown', () => {
    assert.match(rules.validateBirthday({ month: 2, day: 30 }, 2026), /does not have/); assert.strictEqual(rules.validateBirthday({ month: 2, day: 29 }, 2026), null);
    assert.match(rules.validateBirthday({ month: 2, day: 29, year: 2001 }, 2026), /leap/); assert.strictEqual(rules.validateBirthday({ month: 2, day: 29, year: 2000 }, 2026), null);
    assert.match(rules.validateBirthday({ month: 1, day: 1, year: 2020 }, 2026), /13/); assert.match(rules.validateBirthday({ month: 1, day: 1, year: 1800 }, 2026), /1900/); assert.ok(rules.validateBirthday({ month: 13, day: 1 }, 2026));
    const at = Date.UTC(2026, 2, 14, 20, 0); // 14 March 20:00 UTC = 15 March 04:00 in UTC+8
    assert.strictEqual(rules.localDate(at, 8).str, '2026-03-15'); assert.strictEqual(rules.localDate(at, 0).str, '2026-03-14');
    assert.ok(rules.isBirthdayToday({ month: 3, day: 15, utcOffset: 8 }, at)); assert.ok(!rules.isBirthdayToday({ month: 3, day: 15, utcOffset: 0 }, at));
    assert.ok(rules.isBirthdayToday({ month: 2, day: 29, utcOffset: 0 }, Date.UTC(2026, 1, 28, 10))); assert.ok(!rules.isBirthdayToday({ month: 2, day: 29, utcOffset: 0 }, Date.UTC(2028, 1, 28, 10))); assert.ok(rules.isBirthdayToday({ month: 2, day: 29, utcOffset: 0 }, Date.UTC(2028, 1, 29, 10)));
    assert.strictEqual(rules.daysUntil({ month: 3, day: 14, utcOffset: 0 }, at), 0); assert.strictEqual(rules.daysUntil({ month: 3, day: 13, utcOffset: 0 }, at), 364); assert.strictEqual(rules.daysUntil({ month: 3, day: 20, utcOffset: 0 }, at), 6);
    assert.strictEqual(rules.ageOn({ year: 2000, utcOffset: 0 }, at), 26); assert.strictEqual(rules.ageOn({ year: null, utcOffset: 0 }, at), null);
    assert.strictEqual(rules.endOfLocalDay(at, 8), Date.UTC(2026, 2, 15, 16, 0)); // the end of 15 March in UTC+8 is 16:00 UTC
    assert.strictEqual(rules.birthdayText('Hi {user} {username} {server} {age}', { userId: U1, username: 'bob', server: 'S', age: 20 }), `Hi <@${U1}> bob S 20`); assert.match(rules.birthdayText(null, { userId: U1, username: 'b', server: 's', age: null }), /Happy birthday/);
});
test('counting and AFK helpers', () => {
    assert.strictEqual(rules.countingNumber(' 12 '), 12); for (const x of ['12a', 'hello', '1 2', '-3', '3.5', '', '1'.repeat(13)]) assert.strictEqual(rules.countingNumber(x), null, x);
    assert.strictEqual(rules.afkDuration(10000), 'less than a minute'); assert.strictEqual(rules.afkDuration(60000), '1 minute'); assert.strictEqual(rules.afkDuration(3 * 3600000), '3 hours'); assert.strictEqual(rules.afkDuration(72 * 3600000), '3 days');
});

// ---------- game engines ----------
test('rps decisions', () => {
    assert.strictEqual(g.rpsResult('rock', 'rock'), 0); assert.strictEqual(g.rpsResult('rock', 'scissors'), 1); assert.strictEqual(g.rpsResult('rock', 'paper'), 2); assert.strictEqual(g.rpsResult('paper', 'rock'), 1); assert.strictEqual(g.rpsResult('scissors', 'paper'), 1);
});
test('tic-tac-toe: rows, columns, diagonals, draw', () => {
    const b = (s) => [...s].map((c) => (c === '.' ? null : c));
    assert.deepStrictEqual(g.tttWinner(b('XXX......')), { winner: 'X', line: [0, 1, 2] }); assert.strictEqual(g.tttWinner(b('O..O..O..')).winner, 'O'); assert.strictEqual(g.tttWinner(b('X...X...X')).winner, 'X'); assert.strictEqual(g.tttWinner(b('..O.O.O..')).winner, 'O');
    assert.strictEqual(g.tttWinner(b('XOXXOOOXX')).winner, 'draw'); assert.strictEqual(g.tttWinner(b('XO.......')), null);
});
test('connect four: gravity, full column, every win direction, draw', () => {
    const grid = g.c4New(); assert.strictEqual(g.c4Drop(grid, 3, 'R'), 5); assert.strictEqual(g.c4Drop(grid, 3, 'Y'), 4); for (let i = 0; i < 4; i++) g.c4Drop(grid, 3, 'R'); assert.strictEqual(g.c4Drop(grid, 3, 'R'), -1); assert.ok(g.c4Full(grid, 3));
    const win = (cells) => { const gr = g.c4New(); for (const [r, c] of cells) gr[r][c] = 'R'; return g.c4Winner(gr); };
    assert.strictEqual(win([[5, 0], [5, 1], [5, 2], [5, 3]]), 'R'); assert.strictEqual(win([[2, 4], [3, 4], [4, 4], [5, 4]]), 'R'); assert.strictEqual(win([[5, 0], [4, 1], [3, 2], [2, 3]]), 'R'); assert.strictEqual(win([[2, 0], [3, 1], [4, 2], [5, 3]]), 'R'); assert.strictEqual(win([[5, 0], [5, 1], [5, 2]]), null);
    const full = g.c4New(); for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) full[r][c] = ((c >> 1) + r) % 2 === 0 ? 'R' : 'Y'; // pairs of columns, alternating rows: never four in a row
    assert.strictEqual(g.c4Winner(full), 'draw');
});
test('hangman and number hints', () => {
    const guessed = new Set(['a']); assert.strictEqual(g.hangMask('banana', guessed), '_ a _ a _ a'); assert.ok(!g.hangWon('banana', guessed)); assert.ok(g.hangWon('banana', new Set(['b', 'a', 'n'])));
    assert.strictEqual(g.guessHint(5, 9), 'higher'); assert.strictEqual(g.guessHint(9, 5), 'lower'); assert.strictEqual(g.guessHint(5, 5), 'correct');
});

// ---------- built-in content ----------
test('content: trivia is well formed, other banks are usable', () => {
    const questions = new Set();
    for (const [cat, diff, q, correct, wrong] of data.TRIVIA) {
        assert.ok(data.TRIVIA_CATEGORIES[cat], q); assert.ok(['easy', 'medium', 'hard'].includes(diff), q); assert.strictEqual(wrong.length, 3, q); assert.strictEqual(new Set([correct, ...wrong]).size, 4, `duplicate answers in: ${q}`);
        for (const a of [correct, ...wrong]) assert.ok(a.length > 0 && a.length <= 80, q); assert.ok(q.length <= 300); assert.ok(!questions.has(q), `duplicate question ${q}`); questions.add(q);
    }
    for (const cat of Object.keys(data.TRIVIA_CATEGORIES)) for (const d of ['easy']) assert.ok(data.TRIVIA.some((t) => t[0] === cat && t[1] === d), `${cat} needs easy questions`);
    assert.ok(data.WOULD_YOU_RATHER.every((p) => p.length === 2 && p[0] && p[1])); assert.ok(data.TRUTHS.length >= 20 && data.DARES.length >= 20 && data.JOKES.every((j) => j.length === 2));
    assert.ok(data.HANGMAN_WORDS.every((w) => /^[a-z]{4,12}$/.test(w))); assert.strictEqual(data.EIGHT_BALL.length, 20);
    for (const a of Object.values(data.ACTIONS)) { assert.ok(a.text.includes('{a}') && a.text.includes('{b}')); assert.ok(a.self.includes('{a}')); }
});

// ---------- service ----------
test('service: settings defaults and updates', () => {
    const fun = createFunService(fresh()); assert.deepStrictEqual(fun.getConfig(G), { gamesEnabled: true, gamesChannelId: null, afkEnabled: true });
    fun.setConfig(G, { gamesEnabled: false, gamesChannelId: CH }); assert.deepStrictEqual(fun.getConfig(G), { gamesEnabled: false, gamesChannelId: CH, afkEnabled: true }); fun.setConfig(G, { gamesChannelId: null }); assert.strictEqual(fun.getConfig(G).gamesChannelId, null);
    assert.throws(() => fun.setConfig('bad', {}), TypeError);
});
test('service: birthdays save, replace, remove, announce once, roles expire', () => {
    const fun = createFunService(fresh()); const b = fun.birthdays;
    assert.deepStrictEqual(b.set(G, U1, { month: 3, day: 14, year: 2000, utcOffset: 8 }), { guildId: G, userId: U1, month: 3, day: 14, year: 2000, utcOffset: 8 }); b.set(G, U1, { month: 4, day: 1 }); assert.strictEqual(b.get(G, U1).month, 4); assert.strictEqual(b.get(G, U1).year, null);
    assert.strictEqual(b.list(G).length, 1); assert.ok(b.remove(G, U1)); assert.ok(!b.remove(G, U1)); assert.strictEqual(b.get(G, U1), null);
    assert.ok(b.claim(G, U1, '2026-03-14')); assert.ok(!b.claim(G, U1, '2026-03-14')); assert.ok(b.claim(G, U1, '2027-03-14'));
    b.trackRole(G, U1, ROLE, 1000); assert.deepStrictEqual(b.dueRoles(999), []); assert.strictEqual(b.dueRoles(1000).length, 1); b.untrackRole(G, U1); assert.strictEqual(b.dueRoles(5000).length, 0);
    assert.deepStrictEqual(b.configuredGuilds(), []); b.setConfig(G, { channelId: CH }); assert.deepStrictEqual(b.configuredGuilds(), [G]); assert.strictEqual(b.getConfig(G).message, null); b.setConfig(G, { message: 'hi {user}' }); assert.strictEqual(b.getConfig(G).channelId, CH);
});
test('service: AFK set, get, clear exactly once', () => {
    const fun = createFunService(fresh(), { now: () => 5000 }); const a = fun.afk;
    assert.deepStrictEqual(a.set(G, U1, 'x'.repeat(300)).reason.length, 100); assert.strictEqual(a.get(G, U1).since, 5000); assert.strictEqual(a.getMany(G, [U1, U2]).length, 1);
    assert.ok(a.clear(G, U1)); assert.strictEqual(a.clear(G, U1), null); assert.strictEqual(a.get(G, U1), null);
});
test('service: counting rules, record, stats', () => {
    const fun = createFunService(fresh()); const c = fun.counting; assert.strictEqual(c.play(G, U1, 1), null); // not set up
    c.setup(G, CH);
    assert.deepStrictEqual(c.play(G, U1, 1), { ok: true, number: 1, newRecord: false }); assert.deepStrictEqual(c.play(G, U2, 2), { ok: true, number: 2, newRecord: true });
    assert.deepStrictEqual(c.play(G, U2, 3), { ok: false, reason: 'twice', at: 2, expected: 3 }); assert.strictEqual(c.getConfig(G).current, 0); assert.strictEqual(c.getConfig(G).record, 2);
    c.play(G, U1, 1); assert.deepStrictEqual(c.play(G, U2, 5), { ok: false, reason: 'wrong', at: 1, expected: 2 });
    assert.deepStrictEqual(c.statsFor(G, U2), { correct: 1, ruined: 2 }); assert.strictEqual(c.top(G)[0].userId, U1);
    c.play(G, U1, 1); c.reset(G); assert.strictEqual(c.getConfig(G).current, 0); c.disable(G); assert.strictEqual(c.play(G, U1, 1), null); assert.strictEqual(c.getConfig(G).record, 2);
});
test('service: bump timer is claimed once', () => {
    let t = 1000; const fun = createFunService(fresh(), { now: () => t }); const b = fun.bump;
    assert.strictEqual(b.start(G, 100), 1100); b.setup(G, { channelId: CH, roleId: ROLE }); assert.ok(!b.getConfig(G).waiting); assert.strictEqual(b.start(G, 7200000), 7201000);
    assert.deepStrictEqual(b.due(7200999), []); assert.strictEqual(b.due(7201000).length, 1); assert.ok(b.claim(G)); assert.ok(!b.claim(G)); assert.deepStrictEqual(b.due(9e9), []);
    b.start(G, 10); b.disable(G); assert.deepStrictEqual(b.due(9e9), []);
});
test('service: game scores', () => {
    const fun = createFunService(fresh()); const s = fun.scores; s.record(G, U1, 'trivia', true); s.record(G, U1, 'trivia', false); s.record(G, U2, 'trivia', true); s.record(G, U2, 'trivia', true);
    assert.deepStrictEqual(s.forUser(G, U1), [{ game: 'trivia', wins: 1, played: 2 }]); assert.deepStrictEqual(s.top(G, 'trivia').map((r) => r.userId), [U2, U1]); assert.throws(() => s.record(G, U1, 'nope', true), FunServiceError);
});

// ---------- flows ----------
function world(over = {}) {
    const fun = createFunService(fresh(), over); flow.games.clear();
    const mk = (extra = {}) => { const calls = []; const i = { customId: '', user: { id: U1 }, guildId: G, channelId: CH, client: { services: { fun } }, memberPermissions: { has: () => false }, options: { getString: () => null, getInteger: () => null, getUser: () => null }, isModalSubmit: () => false, isFromMessage: () => true,
        reply: async (p) => { calls.push(['reply', p]); }, update: async (p) => { calls.push(['update', p]); }, fetchReply: async () => ({ edit: async () => {} }), showModal: async (m) => { calls.push(['modal', m]); }, ...extra }; i.calls = calls; return i; };
    const click = async (customId, user = U1, extra = {}) => { const i = mk({ customId, user: { id: user }, ...extra }); await flow.handleFunComponent(i); return i; };
    return { fun, mk, click, lastId: () => [...flow.games.keys()].pop() };
}
const text = (i) => json(i.calls.map((c) => c[1]));
const user = (id, bot = false) => ({ id, bot });

test('flow: tic-tac-toe turn order, player check, win recorded', async () => {
    const w = world(); const start = w.mk(); await flow.startTtt(start, user(U2)); const id = w.lastId(); assert.match(text(start), /Tic-Tac-Toe/);
    assert.match(text(await w.click(`fn:ttt:${id}:0`, U3)), /Only the two players/); assert.match(text(await w.click(`fn:ttt:${id}:0`, U2)), /not your turn/);
    for (const [cell, who] of [[0, U1], [3, U2], [1, U1], [4, U2]]) assert.strictEqual((await w.click(`fn:ttt:${id}:${cell}`, who)).calls[0][0], 'update');
    assert.match(text(await w.click(`fn:ttt:${id}:3`, U1)), /taken/);
    const last = await w.click(`fn:ttt:${id}:2`, U1); assert.match(text(last), /wins/); assert.ok(!flow.games.has(id));
    assert.strictEqual(w.fun.scores.top(G, 'tictactoe')[0].userId, U1); assert.match(text(await w.click(`fn:ttt:${id}:5`, U2)), /ended or expired/);
});
test('flow: opponent rules (no bots, no self) and game gate', async () => {
    const w = world(); for (const opp of [user(U1), user(U2, true), null]) { const i = w.mk(); await flow.startTtt(i, opp); assert.ok(i.calls[0][1].flags !== undefined || /Choose|cannot|Bots/.test(text(i))); assert.strictEqual(flow.games.size, 0); }
    w.fun.setConfig(G, { gamesEnabled: false }); const off = w.mk(); await flow.startRps(off, null); assert.match(text(off), /switched off/); assert.strictEqual(flow.games.size, 0);
    const mod = w.mk({ memberPermissions: { has: () => true } }); await flow.startRps(mod, null); assert.strictEqual(flow.games.size, 1); flow.games.clear();
    w.fun.setConfig(G, { gamesEnabled: true, gamesChannelId: '999999999999999999' }); const wrong = w.mk(); await flow.startRps(wrong, null); assert.match(text(wrong), /only work in/); assert.strictEqual(flow.games.size, 0);
});
test('flow: rock paper scissors against me and between members (picks stay secret)', async () => {
    const w = world(); const a = w.mk(); await flow.startRps(a, null); const id = w.lastId();
    assert.match(text(await w.click(`fn:rps:${id}:rock`, U2)), /not yours/); const res = await w.click(`fn:rps:${id}:rock`); assert.match(text(res), /chose/); assert.ok(!flow.games.has(id)); assert.strictEqual(w.fun.scores.forUser(G, U1)[0].played, 1);
    const b = w.mk(); await flow.startRps(b, user(U2)); const id2 = w.lastId();
    assert.match(text(await w.click(`fn:rps:${id2}:rock`, U3)), /Only the two players/);
    const first = await w.click(`fn:rps:${id2}:rock`, U1); assert.strictEqual(first.calls[0][0], 'reply'); assert.ok(first.calls[0][1].flags); assert.ok(!/wins|tie/.test(text(first)));
    assert.match(text(await w.click(`fn:rps:${id2}:paper`, U1)), /already chose/);
    const done = await w.click(`fn:rps:${id2}:scissors`, U2); assert.strictEqual(done.calls[0][0], 'update'); assert.match(text(done), new RegExp(`<@${U1}>\\*\\* wins`)); // rock beats scissors
});

test('flow: connect four gravity, turns, full column and a vertical win', async () => {
    const w = world(); const start = w.mk(); await flow.startC4(start, user(U2)); const id = w.lastId(); assert.match(text(start), /Connect Four/);
    assert.match(text(await w.click(`fn:c4:${id}:0`, U2)), /not your turn/); assert.match(text(await w.click(`fn:c4:${id}:0`, U3)), /Only the two players/);
    for (const [col, who] of [[0, U1], [1, U2], [0, U1], [1, U2], [0, U1], [1, U2]]) await w.click(`fn:c4:${id}:${col}`, who);
    const win = await w.click(`fn:c4:${id}:0`, U1); assert.match(text(win), /wins/); assert.ok(!flow.games.has(id)); assert.strictEqual(w.fun.scores.top(G, 'connect4')[0].userId, U1);
});
test('flow: trivia first correct answer wins, wrong answers lock you out', async () => {
    const w = world(); const start = w.mk({ options: { getString: () => null } }); await flow.startTrivia(start); const id = w.lastId(); const s = flow.games.get(id); assert.match(text(start), /trivia/);
    const wrong = [0, 1, 2, 3].find((i) => i !== s.correctIndex);
    assert.match(text(await w.click(`fn:tv:${id}:${wrong}`, U2)), /Not quite/); assert.match(text(await w.click(`fn:tv:${id}:${s.correctIndex}`, U2)), /already answered/);
    const win = await w.click(`fn:tv:${id}:${s.correctIndex}`, U3); assert.match(text(win), new RegExp(`<@${U3}> got it`)); assert.ok(!flow.games.has(id));
    assert.match(text(await w.click(`fn:tv:${id}:${s.correctIndex}`, U1)), /over/); assert.strictEqual(w.fun.scores.top(G, 'trivia')[0].userId, U3);
});
test('flow: trivia filters, never repeats back-to-back, honest when empty', () => {
    const w = world(); const seen = new Set(); for (let i = 0; i < 10; i++) { const q = flow.pickQuestion('g-repeat', 'science', 'easy'); seen.add(q.question); assert.strictEqual(q.options[q.correctIndex] !== undefined, true); assert.strictEqual(q.options.length, 4); }
    assert.ok(seen.size >= 4); assert.strictEqual(flow.pickQuestion(G, 'science', 'impossible'), null);
});
test('flow: would-you-rather counts one vote each and lets people change it', async () => {
    const w = world(); await flow.startWyr(w.mk()); const id = w.lastId();
    await w.click(`fn:wy:${id}:0`, U1); await w.click(`fn:wy:${id}:0`, U2); const last = await w.click(`fn:wy:${id}:1`, U1); assert.strictEqual(flow.games.get(id).votes.size, 2); assert.match(text(last), /▰/);
    const votes = [...flow.games.get(id).votes.values()]; assert.deepStrictEqual(votes.sort(), [0, 1]);
});
test('flow: truth or dare buttons give new prompts to anyone', async () => {
    const w = world(); for (const kind of ['truth', 'dare', 'random']) { const i = await w.click(`fn:td:0:${kind}`, U2); assert.strictEqual(i.calls[0][0], 'reply'); assert.ok(text(i).includes(`<@${U2}>`)); }
    assert.strictEqual((await w.click('fn:td:0:hack', U2)).calls.length, 0);
});
test('flow: hangman through the form (letters, whole word, lose)', async () => {
    const w = world(); await flow.startHangman(w.mk()); const id = w.lastId(); flow.games.get(id).word = 'cat';
    const open = await w.click(`fn:hn:${id}:x`); assert.strictEqual(open.calls[0][0], 'modal');
    const guess = (v, who = U1) => w.click(`fn:hm:${id}`, who, { isModalSubmit: () => true, fields: { getTextInputValue: () => v } });
    assert.match(text(await guess('1')), /letters a-z/); await guess('c'); assert.match(text(await guess('c')), /already tried/); assert.match(text(await guess('z')), /🔤/); assert.strictEqual(flow.games.get(id).wrong.size, 1);
    const win = await guess('cat', U2); assert.match(text(win), /Solved/); assert.ok(!flow.games.has(id)); assert.strictEqual(w.fun.scores.top(G, 'hangman')[0].userId, U2);
    await flow.startHangman(w.mk()); const id2 = w.lastId(); flow.games.get(id2).word = 'cat';
    for (const l of 'qwerzx') { const i = w.mk({ customId: `fn:hm:${id2}`, isModalSubmit: () => true, fields: { getTextInputValue: () => l } }); await flow.handleFunComponent(i); }
    assert.ok(!flow.games.has(id2)); // six wrong letters ends the game
});
test('flow: number guess gives hints, rejects bad input, ends on win or after 10 tries', async () => {
    const w = world(); const opts = { options: { getInteger: () => 100, getString: () => null } };
    await flow.startGuess(w.mk(opts)); const id = w.lastId(); flow.games.get(id).target = 42;
    const guess = (v, who = U1) => w.click(`fn:gm:${id}`, who, { isModalSubmit: () => true, fields: { getTextInputValue: () => v } });
    assert.match(text(await guess('abc')), /whole number/); assert.match(text(await guess('500')), /1 to 100/); assert.match(text(await guess('50')), /lower/); assert.match(text(await guess('50')), /already guessed/); assert.match(text(await guess('10', U2)), /higher/);
    const win = await guess('42', U2); assert.match(text(win), /Solved/); assert.ok(!flow.games.has(id)); assert.strictEqual(w.fun.scores.top(G, 'guess')[0].userId, U2);
    await flow.startGuess(w.mk(opts)); const id2 = w.lastId(); flow.games.get(id2).target = 100; let lost;
    for (let n = 1; n <= 10; n++) lost = await w.click(`fn:gm:${id2}`, U1, { isModalSubmit: () => true, fields: { getTextInputValue: () => String(n) } });
    assert.match(text(lost), /Out of tries/); assert.ok(!flow.games.has(id2));
});
test('flow: old games are swept away', () => {
    const w = world(); flow.games.set('old', { expires: 1 }); flow.games.set('new', { expires: Date.now() + 10000 }); flow.sweep(); assert.ok(!flow.games.has('old')); assert.ok(flow.games.has('new')); flow.games.clear();
});

// ---------- messages: counting, AFK, bump ----------
function message(w, { content = '', author = { id: U1, bot: false }, channelId = CH, mentions = [] } = {}) {
    const sent = [], reacted = [];
    const m = { guild: { id: G }, channelId, channel: { send: async (p) => { sent.push(p); } }, author, content, embeds: [], client: { services: { fun: w.fun } }, mentions: { users: new Map(mentions.map((u) => [u.id, u])) },
        react: async (e) => { reacted.push(e); }, reply: async (p) => { sent.push(p); } };
    m.sent = sent; m.reacted = reacted; return m;
}
test('messages: counting reacts, ruins, and ignores chat', async () => {
    const w = world(); w.fun.counting.setup(G, CH); const send = async (content, id = U1, channelId = CH) => { const m = message(w, { content, author: { id, bot: false }, channelId }); await flow.handleMessage(m); return m; };
    assert.deepStrictEqual((await send('hello there')).reacted, []); assert.deepStrictEqual((await send('1')).reacted, ['✅']); assert.deepStrictEqual((await send('2', U2)).reacted, ['🏆']);
    const twice = await send('3', U2); assert.deepStrictEqual(twice.reacted, ['❌']); assert.match(json(twice.sent), /ruined it at \*\*2\*\*.*twice in a row/); assert.strictEqual(w.fun.counting.getConfig(G).current, 0);
    await send('1'); const wrong = await send('7', U2); assert.match(json(wrong.sent), /next number was \*\*2\*\*/);
    assert.deepStrictEqual((await send('1', U1, '999999999999999999')).reacted, []); // other channels are ignored
    const bot = message(w, { content: '1', author: { id: U3, bot: true } }); await flow.handleMessage(bot); assert.deepStrictEqual(bot.reacted, []);
});
test('messages: AFK is announced when mentioned and cleared when the person talks', async () => {
    const w = world({ now: () => Date.now() - 60000 }); w.fun.afk.set(G, U1, 'dinner');
    const ping = message(w, { content: 'hey', author: { id: U2, bot: false }, mentions: [{ id: U1, bot: false }, { id: U2, bot: false }, { id: U3, bot: true }] }); await flow.handleMessage(ping);
    assert.match(json(ping.sent), /is AFK: \*\*dinner\*\*/); assert.strictEqual(ping.sent.length, 1); assert.ok(w.fun.afk.get(G, U1));
    const back = message(w, { content: 'I am back' }); await flow.handleMessage(back); assert.match(json(back.sent), /Welcome back/); assert.strictEqual(w.fun.afk.get(G, U1), null);
    const again = message(w, { content: 'again' }); await flow.handleMessage(again); assert.strictEqual(again.sent.length, 0);
    w.fun.afk.set(G, U1, 'x'); w.fun.setConfig(G, { afkEnabled: false }); const off = message(w, { content: 'hi', mentions: [{ id: U1 }], author: { id: U2, bot: false } }); await flow.handleMessage(off); assert.strictEqual(off.sent.length, 0);
});
test('messages: a fresh /afk is not cleared by the command message itself', async () => {
    const w = world(); w.fun.afk.set(G, U1, 'now'); const m = message(w, { content: '!afk now' }); await flow.handleMessage(m); assert.ok(w.fun.afk.get(G, U1)); assert.strictEqual(m.sent.length, 0);
});
test('messages: DISBOARD "Bump done" starts the 2 hour timer, other bots do not', async () => {
    const w = world(); w.fun.bump.setup(G, { channelId: CH, roleId: ROLE });
    const fake = message(w, { author: { id: U3, bot: true } }); fake.embeds = [{ description: 'Bump done!' }]; await flow.handleMessage(fake); assert.ok(!w.fun.bump.getConfig(G).waiting);
    const real = message(w, { author: { id: rules.DISBOARD_ID, bot: true } }); real.embeds = [{ description: 'Bump done! 👍 Check it out' }]; await flow.handleMessage(real);
    const cfg = w.fun.bump.getConfig(G); assert.ok(cfg.waiting); assert.ok(cfg.nextAt - Date.now() > 7190000); assert.match(json(real.sent), /Thanks for bumping/);
    const other = message(w, { author: { id: rules.DISBOARD_ID, bot: true } }); other.embeds = [{ description: 'Please wait 1 hour' }]; w.fun.bump.claim(G); await flow.handleMessage(other); assert.ok(!w.fun.bump.getConfig(G).waiting);
});

// ---------- scheduler ----------
function fakeClient(w, { editable = true } = {}) {
    const log = { sent: [], added: [], removed: [] };
    const channel = { send: async (p) => { log.sent.push(p); } };
    const role = { id: ROLE, editable };
    const member = { user: { username: 'bob' }, roles: { add: async (r) => { log.added.push(r.id ?? r); return true; }, remove: async (r) => { log.removed.push(r); } } };
    const guild = { id: G, name: 'Test Server', channels: { cache: new Map([[CH, channel]]) }, roles: { cache: new Map([[ROLE, role]]) }, members: { fetch: async (id) => { if (id === U3) throw new Error('Unknown Member'); return member; } } };
    return { services: { fun: w.fun }, guilds: { cache: new Map([[G, guild]]) }, log };
}
test('scheduler: bump reminder is sent once, pings only the chosen role', async () => {
    const w = world(); const client = fakeClient(w); w.fun.bump.setup(G, { channelId: CH, roleId: ROLE }); w.fun.bump.start(G, -1000);
    await flow.funTick(client, { birthdays: false }); await flow.funTick(client, { birthdays: false });
    assert.strictEqual(client.log.sent.length, 1); assert.match(client.log.sent[0].content, new RegExp(`<@&${ROLE}> .*Time to bump`)); assert.deepStrictEqual(client.log.sent[0].allowedMentions, { roles: [ROLE] });
});
test('scheduler: birthdays are announced once per day, roles given and taken away', async () => {
    const w = world(); const client = fakeClient(w); const now = Date.now(); const t = rules.localDate(now, 0);
    w.fun.birthdays.setConfig(G, { channelId: CH, roleId: ROLE, message: 'Happy {age}th, {username}!' });
    w.fun.birthdays.set(G, U1, { month: t.m, day: t.d, year: t.y - 20, utcOffset: 0 });
    w.fun.birthdays.set(G, U2, { month: t.m === 12 ? 1 : t.m + 1, day: 1, utcOffset: 0 }); // not today
    w.fun.birthdays.set(G, U3, { month: t.m, day: t.d, utcOffset: 0 }); // not in the server any more
    await flow.birthdayPass(client, now); await flow.birthdayPass(client, now);
    assert.strictEqual(client.log.sent.length, 1); assert.strictEqual(client.log.sent[0].content, 'Happy 20th, bob!'); assert.deepStrictEqual(client.log.sent[0].allowedMentions, { users: [U1] }); assert.deepStrictEqual(client.log.added, [ROLE]);
    assert.strictEqual(w.fun.birthdays.dueRoles(rules.endOfLocalDay(now, 0) + 1).length, 1);
    w.fun.birthdays.trackRole(G, U1, ROLE, now - 1); await flow.funTick(client, { birthdays: false }); assert.deepStrictEqual(client.log.removed, [ROLE]); assert.strictEqual(w.fun.birthdays.dueRoles(9e15).length, 0);
});
test('scheduler: no role when the bot cannot manage it', async () => {
    const w = world(); const client = fakeClient(w, { editable: false }); const t = rules.localDate(Date.now(), 0); w.fun.birthdays.setConfig(G, { channelId: CH, roleId: ROLE }); w.fun.birthdays.set(G, U1, { month: t.m, day: t.d, utcOffset: 0 });
    await flow.birthdayPass(client, Date.now()); assert.strictEqual(client.log.sent.length, 1); assert.deepStrictEqual(client.log.added, []);
});

// ---------- commands ----------
const LEGACY = { dice: ['random', 'dice'], choose: ['random', 'choose'], coinflip: ['random', 'coinflip'], eightball: ['random', '8ball'], joke: ['random', 'joke'], rate: ['random', 'rate'], ship: ['random', 'ship'], action: ['random', 'action'], gamestats: ['play', 'stats'] };
const run = async (file, opts = {}, extra = {}) => {
    if (LEGACY[file]) { opts = { ...opts, sub: LEGACY[file][1] }; file = LEGACY[file][0]; }
    const w = extra.w ?? world(); const replies = []; const get = (n) => opts[n] ?? null;
    const i = { user: { id: U1, username: 'alice' }, guild: { id: G, members: { cache: new Map() } }, guildId: G, channelId: CH, client: { services: { fun: w.fun } }, inGuild: () => true, memberPermissions: { has: () => Boolean(extra.mod) }, deferred: false, replied: false,
        options: { getSubcommand: () => opts.sub, getString: get, getInteger: get, getUser: get, getBoolean: get, getChannel: get, getRole: get }, reply: async (p) => { replies.push(p); } };
    await require(`../src/commands/fun/${file}`).execute(i); return { out: replies.map((r) => r.content ?? '').join('\n'), w, replies };
};
test('commands: quick fun commands answer sensibly', async () => {
    assert.match((await run('dice', { roll: '2d6' })).out, /2d6/); assert.match((await run('dice', { roll: 'nope' })).out, /could not read/);
    assert.match((await run('choose', { options: 'a, b' })).out, /I choose: \*\*(a|b)\*\*/); assert.match((await run('choose', { options: 'a' })).out, /at least 2/);
    assert.match((await run('coinflip')).out, /Heads|Tails/); assert.match((await run('eightball', { question: 'Will I win?' })).out, /Will I win\?/); assert.match((await run('joke')).out, /\|\|/);
    assert.match((await run('rate', { thing: 'pizza' })).out, /pizza.*\/10/); assert.match((await run('ship', { user: { id: U1, username: 'a' }, other: { id: U2, username: 'b' } })).out, /%/); assert.match((await run('ship', { user: { id: U1, username: 'a' } })).out, /100%/);
    assert.match((await run('action', { type: 'hug', user: { id: U2 } })).out, new RegExp(`<@${U1}> .*<@${U2}>`)); assert.match((await run('action', { type: 'hug', user: { id: U1 } })).out, /hugs themselves/);
});
test('commands: birthday set validates, view/remove work, staff settings need Manage Server', async () => {
    const w = world(); const o = (opts, extra = {}) => run('birthday', opts, { w, ...extra });
    assert.match((await o({ sub: 'set', month: 2, day: 30 })).out, /does not have/); assert.match((await o({ sub: 'set', month: 3, day: 14, year: 2020 })).out, /13/);
    assert.match((await o({ sub: 'set', month: 3, day: 14, 'utc-offset': 8 })).out, /Saved/); assert.match((await o({ sub: 'view' })).out, /14 March/); assert.match((await o({ sub: 'view', user: { id: U2 } })).out, /has not saved/);
    assert.match((await o({ sub: 'channel', channel: { id: CH } })).out, /Manage Server/); assert.strictEqual(w.fun.birthdays.getConfig(G).channelId, null);
    assert.match((await o({ sub: 'channel', channel: { id: CH } }, { mod: true })).out, /Birthday messages will be sent/); assert.strictEqual(w.fun.birthdays.getConfig(G).channelId, CH);
    assert.match((await o({ sub: 'remove' })).out, /removed/); assert.match((await o({ sub: 'remove' })).out, /not saved/);
});
test('commands: afk, counting setup, bump, fun settings', async () => {
    const w = world(); assert.match((await run('afk', { reason: 'lunch' }, { w })).out, /lunch/); assert.strictEqual(w.fun.afk.get(G, U1).reason, 'lunch'); w.fun.setConfig(G, { afkEnabled: false }); assert.match((await run('afk', {}, { w })).out, /switched off/);
    assert.match((await run('counting', { sub: 'setup', channel: { id: CH } }, { w })).out, /Manage Server/); assert.match((await run('counting', { sub: 'setup', channel: { id: CH } }, { w, mod: true })).out, /Counting is on/); assert.strictEqual(w.fun.counting.getConfig(G).channelId, CH);
    assert.match((await run('counting', { sub: 'stats' }, { w })).out, /Record/);
    assert.match((await run('bump', { sub: 'start' }, { w, mod: true })).out, /not set up/); await run('bump', { sub: 'setup', channel: { id: CH } }, { w, mod: true }); assert.match((await run('bump', { sub: 'start' }, { w, mod: true })).out, /remind you/);
    await run('fun', { sub: 'games', enabled: false, channel: { id: CH } }, { w, mod: true }); assert.deepStrictEqual([w.fun.getConfig(G).gamesEnabled, w.fun.getConfig(G).gamesChannelId], [false, CH]);
    const status = await run('fun', { sub: 'games', 'any-channel': true }, { w, mod: true }); assert.strictEqual(w.fun.getConfig(G).gamesChannelId, null); assert.match(status.out, /Counting: ✅/);
});
test('commands: gamestats shows wins and top players', async () => {
    const w = world(); w.fun.scores.record(G, U1, 'trivia', true); assert.match((await run('gamestats', {}, { w })).out, /Trivia.*1\*\* win/); assert.match((await run('gamestats', { game: 'trivia' }, { w })).out, /Top players/); assert.match((await run('gamestats', { game: 'rps' }, { w })).out, /Nobody/);
});
