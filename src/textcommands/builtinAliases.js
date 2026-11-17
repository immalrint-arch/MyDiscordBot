// Old command names that were folded into /play and /random keep working as text commands (!8ball, !dice, ...).
const BUILTIN_ALIASES = {
    coinflip: 'random coinflip', dice: 'random dice', '8ball': 'random 8ball', choose: 'random choose', rate: 'random rate', ship: 'random ship', joke: 'random joke', action: 'random action',
    trivia: 'play trivia', rps: 'play rps', tictactoe: 'play tictactoe', connect4: 'play connect4', guess: 'play guess-number', hangman: 'play hangman', wouldyourather: 'play would-you-rather', truthordare: 'play truth-or-dare', gamestats: 'play stats',
};
module.exports = { BUILTIN_ALIASES };
