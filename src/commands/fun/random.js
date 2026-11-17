const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../moderation/helpers');
const { EIGHT_BALL, ACTIONS, JOKES } = require('../../fun/data');
const rules = require('../../fun/rules');
const { cleanText } = require('../../utils/text');

module.exports = {
    data: new SlashCommandBuilder().setName('random').setDescription('Quick fun: coin flip, dice, 8-ball, choose, rate, ship, joke, hugs.')
        .addSubcommand((s) => s.setName('coinflip').setDescription('Flip a coin.'))
        .addSubcommand((s) => s.setName('dice').setDescription('Roll dice, like 2d20+3 (default: one 6-sided die).')
            .addStringOption((o) => o.setName('roll').setDescription('Example: d20, 3d6, 2d10+5 (up to 20 dice, up to 1000 sides)').setMaxLength(20)))
        .addSubcommand((s) => s.setName('8ball').setDescription('Ask the magic 8-ball a yes/no question.')
            .addStringOption((o) => o.setName('question').setDescription('Your yes/no question').setRequired(true).setMaxLength(200)))
        .addSubcommand((s) => s.setName('choose').setDescription('Cannot decide? I will pick for you.')
            .addStringOption((o) => o.setName('options').setDescription('Options separated by commas or |, e.g. pizza, burgers, tacos').setRequired(true).setMaxLength(500)))
        .addSubcommand((s) => s.setName('rate').setDescription('I rate anything out of 10.')
            .addStringOption((o) => o.setName('thing').setDescription('What should I rate?').setRequired(true).setMaxLength(100)))
        .addSubcommand((s) => s.setName('ship').setDescription('How compatible are two members? (just for fun)')
            .addUserOption((o) => o.setName('user').setDescription('The first person').setRequired(true))
            .addUserOption((o) => o.setName('other').setDescription('The second person (default: you)')))
        .addSubcommand((s) => s.setName('joke').setDescription('Hear a (terrible) joke.'))
        .addSubcommand((s) => s.setName('action').setDescription('Hug, pat, high-five… a member.')
            .addStringOption((o) => o.setName('type').setDescription('What to do').setRequired(true).addChoices(...Object.entries(ACTIONS).map(([value, a]) => ({ name: `${a.emoji} ${value}`, value }))))
            .addUserOption((o) => o.setName('user').setDescription('Who to do it to').setRequired(true))),

    async execute(interaction) {
        const o = interaction.options;
        switch (o.getSubcommand()) {
            case 'coinflip': return respond(interaction, `🪙 It is **${Math.random() < 0.5 ? 'Heads' : 'Tails'}**!`);
            case 'dice': {
                const spec = rules.parseDice(o.getString('roll') ?? '1d6');
                if (!spec) return respond(interaction, 'I could not read that. Try `d20`, `3d6` or `2d10+5` (up to 20 dice, 2-1000 sides).');
                const { rolls, total } = rules.rollDice(spec);
                return respond(interaction, `🎲 **${spec.count}d${spec.sides}${spec.mod ? (spec.mod > 0 ? `+${spec.mod}` : spec.mod) : ''}** → ${rolls.length > 1 || spec.mod ? `[${rolls.join(', ')}]${spec.mod ? ` ${spec.mod > 0 ? '+' : '−'} ${Math.abs(spec.mod)}` : ''} = ` : ''}**${total}**`);
            }
            case '8ball': { const [answer, mood] = rules.pick(EIGHT_BALL); return respond(interaction, `🎱 **${cleanText(o.getString('question', true), 200)}**\n${mood === 'good' ? '🟢' : mood === 'maybe' ? '🟡' : '🔴'} ${answer}`); }
            case 'choose': { const r = rules.parseChoices(o.getString('options', true)); return respond(interaction, r.problem ?? `🤔 I choose: **${rules.pick(r.options)}**`); }
            case 'rate': { const thing = cleanText(o.getString('thing', true), 100); const n = rules.ratePercent(thing); return respond(interaction, `⭐ I rate **${thing}** a **${n}/10** ${'⭐'.repeat(Math.ceil(n / 2))}`); }
            case 'ship': {
                const a = o.getUser('user', true); const b = o.getUser('other') ?? interaction.user;
                if (a.id === b.id) return respond(interaction, '💘 Self-love is important! **100%** 💯');
                const p = rules.shipPercent(a.id, b.id); return respond(interaction, `💞 **${a.username}** × **${b.username}**\n${rules.bar(p)} **${p}%**\n${rules.shipLabel(p)}`);
            }
            case 'joke': { const [q, a] = rules.pick(JOKES); return respond(interaction, `😄 **${q}**\n||${a}||`); }
            default: {
                const act = ACTIONS[o.getString('type', true)]; const target = o.getUser('user', true);
                return respond(interaction, (target.id === interaction.user.id ? act.self : act.text).replace('{a}', `<@${interaction.user.id}>`).replace('{b}', `<@${target.id}>`));
            }
        }
    },
};
