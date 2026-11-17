// Games (buttons + forms), message watching (counting, AFK, bump) and the fun scheduler.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const crypto = require('node:crypto');
const logger = require('../utils/logger');
const rules = require('./rules');
const g = require('./games');
const data = require('./data');

const NOBODY = { parse: [] };
const COLOR = 0x5865f2, GREEN = 0x2ecc71, RED = 0xe74c3c, GREY = 0x95a5a6;
const GAME_TTL = 30 * 60 * 1000; // a game that nobody touches for 30 minutes is forgotten
const TRIVIA_MS = 20 * 1000;
const games = new Map(); // gameId -> state (in memory: games are short, a restart simply ends them)
const recentTrivia = new Map(); // guildId -> last question numbers (to avoid repeats)

const newId = () => crypto.randomBytes(4).toString('hex');
function sweep(now = Date.now()) { for (const [id, s] of games) if (s.expires <= now) { if (s.timer) clearTimeout(s.timer); games.delete(id); } }
function register(state) { sweep(); const id = newId(); games.set(id, { ...state, expires: Date.now() + GAME_TTL }); return id; }
const touch = (s) => { s.expires = Date.now() + GAME_TTL; };
const tell = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: NOBODY });
const btn = (id, label, style = ButtonStyle.Secondary, disabled = false, emoji = null) => { const b = new ButtonBuilder().setCustomId(id).setStyle(style).setDisabled(disabled); if (label) b.setLabel(label); if (emoji) b.setEmoji(emoji); return b; };
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
const mention = (id) => `<@${id}>`;

// Games may be limited to one channel; moderators are never blocked. Returns true if the game may start.
async function gate(interaction) {
    const cfg = interaction.client.services.fun.getConfig(interaction.guildId);
    const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    if (!cfg.gamesEnabled && !isMod) { await interaction.reply({ content: '🎮 Games are switched off in this server.', allowedMentions: NOBODY }); return false; }
    if (cfg.gamesChannelId && cfg.gamesChannelId !== interaction.channelId && !isMod) { await interaction.reply({ content: `🎮 Games only work in <#${cfg.gamesChannelId}>.`, allowedMentions: NOBODY }); return false; }
    return true;
}
const pickOpponent = (interaction, user) => {
    if (!user) return 'Choose someone to play against.';
    if (user.bot) return 'Bots cannot play this game. Pick a real person!';
    if (user.id === interaction.user.id) return 'You cannot play against yourself. Pick someone else!';
    return null;
};

// ================= rock paper scissors =================
const rpsRow = (id, disabled = false) => row(...Object.entries(g.RPS).map(([k, v]) => btn(`fn:rps:${id}:${k}`, k[0].toUpperCase() + k.slice(1), ButtonStyle.Primary, disabled, v.emoji)));
async function startRps(interaction, opponent) {
    if (!(await gate(interaction))) return;
    if (opponent) { const problem = pickOpponent(interaction, opponent); if (problem) return tell(interaction, problem); }
    const id = register({ kind: 'rps', guildId: interaction.guildId, a: interaction.user.id, b: opponent?.id ?? null, picks: {} });
    const text = opponent ? `✊ ${mention(interaction.user.id)} challenges ${mention(opponent.id)} to **Rock Paper Scissors**!\nBoth of you pick below. Your pick stays secret until you have both chosen.` : `✊ ${mention(interaction.user.id)} plays **Rock Paper Scissors** against me! Pick one:`;
    return interaction.reply({ content: text, components: [rpsRow(id)], allowedMentions: opponent ? { users: [opponent.id] } : NOBODY });
}
function rpsResultText(s, picks) {
    const A = mention(s.a), B = s.b ? mention(s.b) : '🤖 Me';
    const r = g.rpsResult(picks.a, picks.b); const e = (k) => `${g.RPS[k].emoji} ${k}`;
    return `${A} chose **${e(picks.a)}**, ${B} chose **${e(picks.b)}**.\n${r === 0 ? '🤝 It is a **tie**!' : `🏆 **${r === 1 ? A : B}** wins!`}`;
}
async function handleRps(interaction, id, choice) {
    const s = games.get(id);
    if (!s) return interaction.update({ components: [rpsRow('x', true)] }).catch(() => {});
    if (!g.RPS[choice]) return null;
    const fun = interaction.client.services.fun;
    const record = (winnerKey) => { for (const [key, uid] of [['a', s.a], ['b', s.b]]) if (uid) fun.scores.record(s.guildId, uid, 'rps', winnerKey === key); };
    if (!s.b) {
        if (interaction.user.id !== s.a) return tell(interaction, 'This game is not yours. Start your own with `/play rps`.');
        const bot = rules.pick(Object.keys(g.RPS)); const picks = { a: choice, b: bot }; games.delete(id);
        const r = g.rpsResult(picks.a, picks.b); record(r === 1 ? 'a' : null);
        return interaction.update({ content: rpsResultText(s, picks), components: [rpsRow(id, true)], allowedMentions: NOBODY });
    }
    const who = interaction.user.id === s.a ? 'a' : interaction.user.id === s.b ? 'b' : null;
    if (!who) return tell(interaction, 'Only the two players can choose. Start your own with `/play rps`.');
    if (s.picks[who]) return tell(interaction, `You already chose ${s.picks[who]}.`);
    s.picks[who] = choice; touch(s);
    if (!s.picks.a || !s.picks.b) return tell(interaction, `You chose ${g.RPS[choice].emoji} **${choice}**. Waiting for the other player…`);
    games.delete(id);
    const r = g.rpsResult(s.picks.a, s.picks.b); record(r === 0 ? null : r === 1 ? 'a' : 'b');
    return interaction.update({ content: rpsResultText(s, s.picks), components: [rpsRow(id, true)], allowedMentions: NOBODY });
}

// ================= tic-tac-toe =================
const TTT_MARK = { X: '❌', O: '⭕' };
function tttPayload(id, s, over = null) {
    const rows = [0, 1, 2].map((r) => row(...[0, 1, 2].map((c) => { const i = r * 3 + c; const m = s.board[i];
        return btn(`fn:ttt:${id}:${i}`, m ? '' : '·', m ? (over?.line.includes(i) ? ButtonStyle.Success : m === 'X' ? ButtonStyle.Danger : ButtonStyle.Primary) : ButtonStyle.Secondary, Boolean(m) || Boolean(over), m ? TTT_MARK[m] : null); })));
    const head = `${TTT_MARK.X} ${mention(s.players.X)}  vs  ${TTT_MARK.O} ${mention(s.players.O)}`;
    const status = over ? (over.winner === 'draw' ? '🤝 It is a **draw**!' : `🏆 ${mention(s.players[over.winner])} wins!`) : `It is ${mention(s.players[s.turn])}'s turn (${TTT_MARK[s.turn]}).`;
    return { content: `**Tic-Tac-Toe**\n${head}\n${status}`, components: rows, allowedMentions: NOBODY };
}
async function startTtt(interaction, opponent) {
    if (!(await gate(interaction))) return;
    const problem = pickOpponent(interaction, opponent); if (problem) return tell(interaction, problem);
    const s = { kind: 'ttt', guildId: interaction.guildId, board: Array(9).fill(null), players: { X: interaction.user.id, O: opponent.id }, turn: 'X' };
    const id = register(s); const payload = tttPayload(id, s);
    return interaction.reply({ ...payload, allowedMentions: { users: [opponent.id] } });
}
async function handleTtt(interaction, id, arg) {
    const s = games.get(id);
    if (!s) return tell(interaction, 'This game has ended or expired. Start a new one with `/play tictactoe`.');
    const cell = Number(arg); if (!Number.isInteger(cell) || cell < 0 || cell > 8 || s.board[cell]) return tell(interaction, 'That square is taken.');
    if (![s.players.X, s.players.O].includes(interaction.user.id)) return tell(interaction, 'Only the two players can play. Start your own with `/play tictactoe`.');
    if (interaction.user.id !== s.players[s.turn]) return tell(interaction, 'It is not your turn.');
    s.board[cell] = s.turn; touch(s);
    const over = g.tttWinner(s.board);
    if (over) { games.delete(id); const fun = interaction.client.services.fun; for (const k of ['X', 'O']) fun.scores.record(s.guildId, s.players[k], 'tictactoe', over.winner === k); }
    else s.turn = s.turn === 'X' ? 'O' : 'X';
    return interaction.update(tttPayload(id, s, over));
}

// ================= connect four =================
const C4_EMOJI = { R: '🔴', Y: '🟡' };
function c4Payload(id, s, over = null) {
    const board = s.grid.map((r) => r.map((c) => (c ? C4_EMOJI[c] : '⚪')).join('')).join('\n');
    const nums = '1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣';
    const status = over ? (over === 'draw' ? '🤝 It is a **draw**!' : `🏆 ${mention(s.players[over])} wins!`) : `It is ${mention(s.players[s.turn])}'s turn (${C4_EMOJI[s.turn]}).`;
    const buttons = Array.from({ length: g.C4_COLS }, (_, c) => btn(`fn:c4:${id}:${c}`, String(c + 1), ButtonStyle.Primary, Boolean(over) || g.c4Full(s.grid, c)));
    return { content: `**Connect Four**\n${C4_EMOJI.R} ${mention(s.players.R)}  vs  ${C4_EMOJI.Y} ${mention(s.players.Y)}\n${status}\n\n${board}\n${nums}`, components: [row(...buttons.slice(0, 4)), row(...buttons.slice(4))], allowedMentions: NOBODY };
}
async function startC4(interaction, opponent) {
    if (!(await gate(interaction))) return;
    const problem = pickOpponent(interaction, opponent); if (problem) return tell(interaction, problem);
    const s = { kind: 'c4', guildId: interaction.guildId, grid: g.c4New(), players: { R: interaction.user.id, Y: opponent.id }, turn: 'R' };
    const id = register(s); return interaction.reply({ ...c4Payload(id, s), allowedMentions: { users: [opponent.id] } });
}
async function handleC4(interaction, id, arg) {
    const s = games.get(id);
    if (!s) return tell(interaction, 'This game has ended or expired. Start a new one with `/play connect4`.');
    if (![s.players.R, s.players.Y].includes(interaction.user.id)) return tell(interaction, 'Only the two players can play. Start your own with `/play connect4`.');
    if (interaction.user.id !== s.players[s.turn]) return tell(interaction, 'It is not your turn.');
    const col = Number(arg); if (!Number.isInteger(col) || col < 0 || col >= g.C4_COLS || g.c4Drop(s.grid, col, s.turn) < 0) return tell(interaction, 'That column is full.');
    touch(s); const over = g.c4Winner(s.grid);
    if (over) { games.delete(id); const fun = interaction.client.services.fun; for (const k of ['R', 'Y']) fun.scores.record(s.guildId, s.players[k], 'connect4', over === k); }
    else s.turn = s.turn === 'R' ? 'Y' : 'R';
    return interaction.update(c4Payload(id, s, over));
}

// ================= trivia =================
const LETTERS = ['A', 'B', 'C', 'D'];
function pickQuestion(guildId, category, difficulty) {
    let pool = data.TRIVIA.map((q, n) => ({ q, n })).filter(({ q }) => (!category || q[0] === category) && (!difficulty || q[1] === difficulty));
    if (!pool.length) return null;
    const recent = recentTrivia.get(guildId) ?? []; const fresh = pool.filter(({ n }) => !recent.includes(n)); if (fresh.length) pool = fresh;
    const chosen = rules.pick(pool); recentTrivia.set(guildId, [...recent, chosen.n].slice(-12));
    const [cat, diff, question, correct, wrong] = chosen.q; const options = rules.shuffle([correct, ...wrong]);
    return { category: cat, difficulty: diff, question, options, correctIndex: options.indexOf(correct) };
}
function triviaPayload(id, s, result = null) {
    const embed = new EmbedBuilder().setColor(result ? (result.winner ? GREEN : RED) : COLOR).setTitle(`${data.TRIVIA_CATEGORIES[s.category]} trivia · ${s.difficulty}`)
        .setDescription(`**${s.question}**\n\n${s.options.map((o, i) => `**${LETTERS[i]}.** ${o}`).join('\n')}`);
    if (!result) embed.setFooter({ text: `First correct answer wins! You have ${TRIVIA_MS / 1000} seconds. One try each.` });
    else embed.addFields({ name: result.winner ? '🏆 Correct!' : '⏰ Time is up!', value: result.winner ? `${mention(result.winner)} got it: **${LETTERS[s.correctIndex]}. ${s.options[s.correctIndex]}**` : `Nobody got it. The answer was **${LETTERS[s.correctIndex]}. ${s.options[s.correctIndex]}**.` });
    const buttons = s.options.map((o, i) => btn(`fn:tv:${id}:${i}`, `${LETTERS[i]}`, result ? (i === s.correctIndex ? ButtonStyle.Success : ButtonStyle.Secondary) : ButtonStyle.Primary, Boolean(result)));
    return { embeds: [embed], components: [row(...buttons)], allowedMentions: NOBODY };
}
async function startTrivia(interaction) {
    if (!(await gate(interaction))) return;
    const q = pickQuestion(interaction.guildId, interaction.options.getString('category'), interaction.options.getString('difficulty'));
    if (!q) return interaction.reply({ content: 'I have no questions for that choice. Try another category or difficulty.', allowedMentions: NOBODY });
    const s = { kind: 'tv', guildId: interaction.guildId, ...q, locked: new Set(), message: null };
    const id = register(s); await interaction.reply(triviaPayload(id, s));
    s.message = await interaction.fetchReply().catch(() => null);
    s.timer = setTimeout(async () => {
        if (!games.has(id)) return; games.delete(id);
        try { await s.message?.edit(triviaPayload(id, s, { winner: null })); } catch (error) { logger.warn(`Trivia timeout edit failed: ${error.message}`); }
    }, TRIVIA_MS); s.timer.unref?.();
}
async function handleTrivia(interaction, id, arg) {
    const s = games.get(id);
    if (!s) return tell(interaction, 'This question is over.');
    if (s.locked.has(interaction.user.id)) return tell(interaction, 'You already answered this one.');
    const fun = interaction.client.services.fun; const i = Number(arg);
    if (i !== s.correctIndex) { s.locked.add(interaction.user.id); fun.scores.record(s.guildId, interaction.user.id, 'trivia', false); return tell(interaction, '❌ Not quite! You are out for this question.'); }
    clearTimeout(s.timer); games.delete(id); fun.scores.record(s.guildId, interaction.user.id, 'trivia', true);
    return interaction.update(triviaPayload(id, s, { winner: interaction.user.id }));
}

// ================= would you rather / truth or dare =================
function wyrPayload(id, s) {
    const n = [0, 0]; for (const v of s.votes.values()) n[v]++; const total = n[0] + n[1] || 1;
    const embed = new EmbedBuilder().setColor(COLOR).setTitle('🤔 Would you rather…')
        .setDescription(`🅰️ **${s.options[0]}**\n${rules.bar((n[0] / total) * 100)} ${n[0]}\n\n🅱️ **${s.options[1]}**\n${rules.bar((n[1] / total) * 100)} ${n[1]}`).setFooter({ text: 'Press a button to vote. You can change your vote.' });
    return { embeds: [embed], components: [row(btn(`fn:wy:${id}:0`, 'Option A', ButtonStyle.Primary, false, '🅰️'), btn(`fn:wy:${id}:1`, 'Option B', ButtonStyle.Danger, false, '🅱️'))], allowedMentions: NOBODY };
}
async function startWyr(interaction) {
    if (!(await gate(interaction))) return;
    const s = { kind: 'wy', options: rules.pick(data.WOULD_YOU_RATHER).map((t) => t[0].toUpperCase() + t.slice(1)), votes: new Map() };
    return interaction.reply(wyrPayload(register(s), s));
}
async function handleWyr(interaction, id, arg) {
    const s = games.get(id); if (!s) return tell(interaction, 'This vote has expired. Start a new one with `/play would-you-rather`.');
    const v = Number(arg); if (v !== 0 && v !== 1) return null; s.votes.set(interaction.user.id, v); touch(s);
    return interaction.update(wyrPayload(id, s));
}
function todPayload(kind, userId) {
    const type = kind === 'random' ? rules.pick(['truth', 'dare']) : kind;
    const text = rules.pick(type === 'truth' ? data.TRUTHS : data.DARES);
    const embed = new EmbedBuilder().setColor(type === 'truth' ? 0x3498db : 0xe67e22).setTitle(type === 'truth' ? '🗣️ Truth' : '🔥 Dare').setDescription(text).setFooter({ text: 'Be kind and keep it fun. Skip anything you are not comfortable with!' });
    return { content: userId ? `For ${mention(userId)}:` : undefined, embeds: [embed], components: [row(btn('fn:td:0:truth', 'Truth', ButtonStyle.Primary, false, '🗣️'), btn('fn:td:0:dare', 'Dare', ButtonStyle.Danger, false, '🔥'), btn('fn:td:0:random', 'Random', ButtonStyle.Secondary, false, '🎲'))], allowedMentions: NOBODY };
}
async function startTod(interaction) { if (!(await gate(interaction))) return; return interaction.reply(todPayload(interaction.options.getString('type') ?? 'random', interaction.user.id)); }
async function handleTod(interaction, _id, arg) { if (!['truth', 'dare', 'random'].includes(arg)) return null; return interaction.reply(todPayload(arg, interaction.user.id)); }

// ================= number guessing and hangman (use a form to type the guess) =================
const GUESS_TRIES = 10;
function modal(customId, title, inputId, label, placeholder, max) {
    return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(row(new TextInputBuilder().setCustomId(inputId).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(max)));
}
function guessPayload(id, s, over = null) {
    const embed = new EmbedBuilder().setColor(over ? (over === 'won' ? GREEN : RED) : COLOR).setTitle('🎯 Guess the number')
        .setDescription(`I am thinking of a number from **1** to **${s.max}**. Anyone can guess! (${s.guesses.length}/${GUESS_TRIES} tries used)`);
    if (s.guesses.length) embed.addFields({ name: 'Guesses', value: s.guesses.slice(-10).map((x) => `\`${x.n}\` → ${x.hint === 'correct' ? '✅ correct!' : x.hint === 'higher' ? '⬆️ higher' : '⬇️ lower'} (${mention(x.user)})`).join('\n') });
    if (over === 'won') embed.addFields({ name: '🏆 Solved!', value: `${mention(s.winner)} found **${s.target}**.` }); else if (over === 'lost') embed.addFields({ name: '😢 Out of tries', value: `The number was **${s.target}**.` });
    return { embeds: [embed], components: over ? [] : [row(btn(`fn:gn:${id}:x`, 'Guess', ButtonStyle.Primary, false, '🎯'))], allowedMentions: NOBODY };
}
async function startGuess(interaction) {
    if (!(await gate(interaction))) return;
    const max = interaction.options.getInteger('max') ?? 100; const s = { kind: 'gn', guildId: interaction.guildId, max, target: 1 + Math.floor(Math.random() * max), guesses: [] };
    return interaction.reply(guessPayload(register(s), s));
}
function hangPayload(id, s, over = null) {
    const wrong = [...s.wrong]; const embed = new EmbedBuilder().setColor(over ? (over === 'won' ? GREEN : RED) : COLOR).setTitle(`🔤 Hangman ${g.HANG_STAGES[Math.min(wrong.length, g.HANG_MAX_WRONG)]}`)
        .setDescription(`\`${g.hangMask(s.word, s.guessed)}\`\n\n**Wrong:** ${wrong.length ? wrong.join(' ') : 'none'}\n**Lives left:** ${g.HANG_MAX_WRONG - wrong.length}`);
    if (over === 'won') embed.addFields({ name: '🏆 Solved!', value: `${mention(s.winner)} finished **${s.word}**.` }); else if (over === 'lost') embed.addFields({ name: '💀 Game over', value: `The word was **${s.word}**.` });
    return { embeds: [embed], components: over ? [] : [row(btn(`fn:hn:${id}:x`, 'Guess a letter or the word', ButtonStyle.Primary, false, '🔤'))], allowedMentions: NOBODY };
}
async function startHangman(interaction) {
    if (!(await gate(interaction))) return;
    const s = { kind: 'hn', guildId: interaction.guildId, word: rules.pick(data.HANGMAN_WORDS), guessed: new Set(), wrong: new Set() };
    return interaction.reply(hangPayload(register(s), s));
}
const reply2 = (interaction, payload) => (interaction.isFromMessage?.() ? interaction.update(payload) : interaction.reply(payload));
async function handleGuessModal(interaction, id) {
    const s = games.get(id); if (!s) return tell(interaction, 'This game is over.');
    const raw = interaction.fields.getTextInputValue('n').trim(); const n = /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
    if (!(n >= 1 && n <= s.max)) return tell(interaction, `Type a whole number from 1 to ${s.max}.`);
    if (s.guesses.some((x) => x.n === n)) return tell(interaction, `Someone already guessed ${n}.`);
    const hint = g.guessHint(n, s.target); s.guesses.push({ n, hint, user: interaction.user.id }); touch(s);
    const fun = interaction.client.services.fun; let over = null;
    if (hint === 'correct') { over = 'won'; s.winner = interaction.user.id; fun.scores.record(s.guildId, s.winner, 'guess', true); }
    else if (s.guesses.length >= GUESS_TRIES) over = 'lost';
    if (over) games.delete(id);
    return reply2(interaction, guessPayload(id, s, over));
}
async function handleHangModal(interaction, id) {
    const s = games.get(id); if (!s) return tell(interaction, 'This game is over.');
    const raw = interaction.fields.getTextInputValue('l').trim().toLowerCase();
    if (!/^[a-z]+$/.test(raw)) return tell(interaction, 'Use letters a-z only.');
    let over = null;
    if (raw.length === 1) {
        if (s.guessed.has(raw) || s.wrong.has(raw)) return tell(interaction, `The letter **${raw}** was already tried.`);
        if (s.word.includes(raw)) s.guessed.add(raw); else s.wrong.add(raw);
    } else if (raw === s.word) [...s.word].forEach((ch) => s.guessed.add(ch));
    else s.wrong.add(raw.slice(0, 12));
    touch(s);
    const fun = interaction.client.services.fun;
    if (g.hangWon(s.word, s.guessed)) { over = 'won'; s.winner = interaction.user.id; fun.scores.record(s.guildId, s.winner, 'hangman', true); }
    else if (s.wrong.size >= g.HANG_MAX_WRONG) over = 'lost';
    if (over) games.delete(id);
    return reply2(interaction, hangPayload(id, s, over));
}

// ================= routing =================
async function handleFunComponent(interaction) {
    const [, kind, id, arg] = interaction.customId.split(':');
    if (interaction.isModalSubmit()) { if (kind === 'gm') return handleGuessModal(interaction, id); if (kind === 'hm') return handleHangModal(interaction, id); return null; }
    switch (kind) {
        case 'rps': return handleRps(interaction, id, arg);
        case 'ttt': return handleTtt(interaction, id, arg);
        case 'c4': return handleC4(interaction, id, arg);
        case 'tv': return handleTrivia(interaction, id, arg);
        case 'wy': return handleWyr(interaction, id, arg);
        case 'td': return handleTod(interaction, id, arg);
        case 'gn': { if (!games.has(id)) return tell(interaction, 'This game is over.'); return interaction.showModal(modal(`fn:gm:${id}`, 'Guess the number', 'n', 'Your guess', 'A whole number', 6)); }
        case 'hn': { if (!games.has(id)) return tell(interaction, 'This game is over.'); return interaction.showModal(modal(`fn:hm:${id}`, 'Hangman', 'l', 'A letter (or the whole word)', 'e', 20)); }
        default: return null;
    }
}

// ================= messages: bump, counting, AFK =================
async function safe(fn) { try { return await fn(); } catch { return null; } }
async function handleMessage(message) {
    if (!message.guild) return;
    const fun = message.client.services.fun;
    // 1. A bump bot says "Bump done": start the 2 hour timer.
    if (message.author?.id === rules.DISBOARD_ID) {
        const said = [message.content, ...(message.embeds ?? []).map((e) => e.description ?? '')].join(' ');
        if (/bump done/i.test(said) && fun.bump.getConfig(message.guild.id).channelId) {
            const at = fun.bump.start(message.guild.id, rules.BUMP_DELAY_MS);
            await safe(() => message.channel.send({ content: `🙏 Thanks for bumping! I will remind you <t:${Math.floor(at / 1000)}:R>.`, allowedMentions: NOBODY }));
        }
        return;
    }
    if (message.author.bot) return;
    const guildId = message.guild.id; const uid = message.author.id;

    // 2. Counting channel.
    const counting = fun.counting.getConfig(guildId);
    if (counting.channelId && counting.channelId === message.channelId) {
        const n = rules.countingNumber(message.content);
        if (n !== null) {
            const r = fun.counting.play(guildId, uid, n);
            if (r?.ok) await safe(() => message.react(r.newRecord ? '🏆' : '✅'));
            else if (r) {
                await safe(() => message.react('❌'));
                const why = r.reason === 'twice' ? 'You cannot count twice in a row!' : `The next number was **${r.expected}**.`;
                await safe(() => message.channel.send({ content: `💥 ${mention(uid)} ruined it at **${r.at}**! ${why}\nWe start again from **1**. (Record: **${counting.record}**)`, allowedMentions: NOBODY }));
            }
        }
    }

    // 3. AFK.
    if (!fun.getConfig(guildId).afkEnabled) return;
    const mine = fun.afk.get(guildId, uid);
    if (mine && Date.now() - mine.since > 5000) {
        fun.afk.clear(guildId, uid);
        await safe(() => message.reply({ content: `👋 Welcome back ${mention(uid)}! I removed your AFK (away for ${rules.afkDuration(Date.now() - mine.since)}).`, allowedMentions: NOBODY }));
    }
    const mentioned = [...(message.mentions?.users?.values?.() ?? [])].filter((u) => !u.bot && u.id !== uid).slice(0, 5);
    if (mentioned.length) {
        const away = fun.afk.getMany(guildId, mentioned.map((u) => u.id));
        if (away.length) await safe(() => message.reply({ content: away.map(([id, a]) => `💤 ${mention(id)} is AFK: **${a.reason}** (since <t:${Math.floor(a.since / 1000)}:R>)`).join('\n'), allowedMentions: { parse: [], repliedUser: false } }));
    }
}

// ================= scheduler: bump reminders and birthdays =================
async function birthdayPass(client, nowMs) {
    const fun = client.services.fun;
    for (const guildId of fun.birthdays.configuredGuilds()) {
        const guild = client.guilds.cache.get(guildId); if (!guild) continue;
        const cfg = fun.birthdays.getConfig(guildId);
        for (const bd of fun.birthdays.list(guildId)) {
            if (!rules.isBirthdayToday(bd, nowMs)) continue;
            const date = rules.localDate(nowMs, bd.utcOffset).str;
            const member = await safe(() => guild.members.fetch(bd.userId)); if (!member) continue;
            if (!fun.birthdays.claim(guildId, bd.userId, date)) continue; // already done today
            const channel = cfg.channelId ? guild.channels.cache.get(cfg.channelId) : null;
            if (channel) await safe(() => channel.send({ content: rules.birthdayText(cfg.message, { userId: bd.userId, username: member.user.username, server: guild.name, age: rules.ageOn(bd, nowMs) }), allowedMentions: { users: [bd.userId] } }));
            const role = cfg.roleId ? guild.roles.cache.get(cfg.roleId) : null;
            if (role?.editable) { const ok = await safe(() => member.roles.add(role, 'Birthday')); if (ok) fun.birthdays.trackRole(guildId, bd.userId, role.id, rules.endOfLocalDay(nowMs, bd.utcOffset)); }
        }
        fun.birthdays.purgeLog(rules.localDate(nowMs - 3 * 86400000, 0).str);
    }
}
async function funTick(client, { birthdays = true } = {}) {
    const fun = client.services.fun; const nowMs = Date.now();
    for (const b of fun.bump.due(nowMs)) {
        if (!fun.bump.claim(b.guildId)) continue;
        const channel = client.guilds.cache.get(b.guildId)?.channels.cache.get(b.channelId);
        await safe(() => channel?.send({ content: `${b.roleId ? `<@&${b.roleId}> ` : ''}⏰ **Time to bump!** Use the bump command again to keep the server visible.`, allowedMentions: b.roleId ? { roles: [b.roleId] } : NOBODY }));
    }
    for (const due of fun.birthdays.dueRoles(nowMs)) {
        const member = await safe(() => client.guilds.cache.get(due.guildId)?.members.fetch(due.userId));
        if (member) await safe(() => member.roles.remove(due.roleId, 'Birthday is over'));
        fun.birthdays.untrackRole(due.guildId, due.userId);
    }
    if (birthdays) await birthdayPass(client, nowMs);
}
function startFunScheduler(client) {
    let running = false; let n = 0;
    const run = async () => { if (running) return; running = true; try { await funTick(client, { birthdays: n++ % 10 === 0 }); } catch (error) { logger.error('Fun check failed:', error); } finally { running = false; } };
    run(); return setInterval(run, 30 * 1000);
}

module.exports = { handleFunComponent, handleMessage, funTick, birthdayPass, startFunScheduler, gate, startRps, startTtt, startC4, startTrivia, startWyr, startTod, startGuess, startHangman, games, pickQuestion, tttPayload, c4Payload, triviaPayload, todPayload, sweep, GAME_TTL };
