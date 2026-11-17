const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../moderation/helpers');
const flow = require('../../fun/funFlow');
const { TRIVIA_CATEGORIES } = require('../../fun/data');

const NAMES = { trivia: '🧠 Trivia', rps: '✊ Rock Paper Scissors', tictactoe: '❌ Tic-Tac-Toe', connect4: '🔴 Connect Four', guess: '🎯 Number guess', hangman: '🔤 Hangman' };
const opponent = (o, required) => o.setName('opponent').setDescription(required ? 'Who do you want to play against?' : 'A member to challenge (leave empty to play against me)').setRequired(required);

module.exports = {
    NAMES,
    data: new SlashCommandBuilder().setName('play').setDescription('Games to play in the chat: trivia, rock-paper-scissors, tic-tac-toe, Connect Four and more.').setDMPermission(false)
        .addSubcommand((s) => s.setName('trivia').setDescription('Answer a quiz question. The first correct answer wins!')
            .addStringOption((o) => o.setName('category').setDescription('Pick a topic (default: any)').addChoices(...Object.entries(TRIVIA_CATEGORIES).map(([value, name]) => ({ name, value }))))
            .addStringOption((o) => o.setName('difficulty').setDescription('Pick how hard (default: any)').addChoices({ name: 'Easy', value: 'easy' }, { name: 'Medium', value: 'medium' }, { name: 'Hard', value: 'hard' })))
        .addSubcommand((s) => s.setName('rps').setDescription('Rock paper scissors against me, or challenge a member.').addUserOption((o) => opponent(o, false)))
        .addSubcommand((s) => s.setName('tictactoe').setDescription('Play tic-tac-toe against another member.').addUserOption((o) => opponent(o, true)))
        .addSubcommand((s) => s.setName('connect4').setDescription('Play Connect Four against another member.').addUserOption((o) => opponent(o, true)))
        .addSubcommand((s) => s.setName('guess-number').setDescription('Guess my secret number (10 tries, I give hints).')
            .addIntegerOption((o) => o.setName('max').setDescription('Highest possible number (default 100)').setMinValue(10).setMaxValue(10000)))
        .addSubcommand((s) => s.setName('hangman').setDescription('Guess the secret word letter by letter.'))
        .addSubcommand((s) => s.setName('would-you-rather').setDescription('Start a "would you rather" vote.'))
        .addSubcommand((s) => s.setName('truth-or-dare').setDescription('Get a truth question or a dare.')
            .addStringOption((o) => o.setName('type').setDescription('Truth, dare, or let me choose (default)').addChoices({ name: 'Truth', value: 'truth' }, { name: 'Dare', value: 'dare' }, { name: 'Random', value: 'random' })))
        .addSubcommand((s) => s.setName('stats').setDescription('See game wins for a member, or the top players of a game.')
            .addUserOption((o) => o.setName('user').setDescription('Whose wins to show (default: you)'))
            .addStringOption((o) => o.setName('game').setDescription('Show the top 10 players of this game instead').addChoices(...Object.entries(NAMES).map(([value, name]) => ({ name, value }))))),

    async execute(interaction) {
        switch (interaction.options.getSubcommand()) {
            case 'trivia': return flow.startTrivia(interaction);
            case 'rps': return flow.startRps(interaction, interaction.options.getUser('opponent'));
            case 'tictactoe': return flow.startTtt(interaction, interaction.options.getUser('opponent', true));
            case 'connect4': return flow.startC4(interaction, interaction.options.getUser('opponent', true));
            case 'guess-number': return flow.startGuess(interaction);
            case 'hangman': return flow.startHangman(interaction);
            case 'would-you-rather': return flow.startWyr(interaction);
            case 'truth-or-dare': return flow.startTod(interaction);
            default: {
                const { fun } = interaction.client.services; const game = interaction.options.getString('game');
                if (game) {
                    const top = fun.scores.top(interaction.guildId, game);
                    return respond(interaction, top.length ? [`**Top players: ${NAMES[game]}**`, ...top.map((r, i) => `${['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`} <@${r.userId}> — ${r.wins} win${r.wins === 1 ? '' : 's'} (${r.played} played)`)].join('\n') : 'Nobody has played that game yet. Be the first!');
                }
                const user = interaction.options.getUser('user') ?? interaction.user; const rows = fun.scores.forUser(interaction.guildId, user.id);
                return respond(interaction, rows.length ? [`**Game stats for <@${user.id}>**`, ...rows.map((r) => `${NAMES[r.game] ?? r.game}: **${r.wins}** win${r.wins === 1 ? '' : 's'} / ${r.played} played`)].join('\n') : `<@${user.id}> has not played any games yet. Try \`/play trivia\`!`);
            }
        }
    },
};
