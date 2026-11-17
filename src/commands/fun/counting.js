const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');

const PERM = PermissionFlagsBits.ManageGuild;
module.exports = {
    data: new SlashCommandBuilder().setName('counting').setDescription('A channel where members count up together: 1, 2, 3…').setDMPermission(false)
        .addSubcommand((s) => s.setName('setup').setDescription('Staff: choose the counting channel (restarts from 1).').addChannelOption((o) => o.setName('channel').setDescription('The counting channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand((s) => s.setName('disable').setDescription('Staff: turn counting off.'))
        .addSubcommand((s) => s.setName('reset').setDescription('Staff: start counting again from 1.'))
        .addSubcommand((s) => s.setName('stats').setDescription('Show the count, the record and top counters.').addUserOption((o) => o.setName('user').setDescription('Show one member\'s numbers'))),
    async execute(interaction) {
        const { fun } = interaction.client.services; const { guild } = interaction; const sub = interaction.options.getSubcommand();
        if (sub !== 'stats' && !(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
        if (sub === 'setup') { const c = interaction.options.getChannel('channel', true); fun.counting.setup(guild.id, c.id);
            return respond(interaction, `🔢 Counting is on in <#${c.id}>! Rules: post the next number, one at a time, and **you cannot count twice in a row**. A wrong number resets to 1. Other chat is allowed. Start with **1**!`); }
        if (sub === 'disable') { fun.counting.disable(guild.id); return respond(interaction, '✅ Counting is off. Stats are kept.'); }
        if (sub === 'reset') { fun.counting.reset(guild.id); return respond(interaction, '🔄 Counting restarted. The next number is **1**.'); }
        const c = fun.counting.getConfig(guild.id); if (!c.channelId && !c.record) return respond(interaction, 'Counting is not set up. Staff can use `/counting setup`.');
        const user = interaction.options.getUser('user');
        if (user) { const s = fun.counting.statsFor(guild.id, user.id); return respond(interaction, `🔢 <@${user.id}>: **${s.correct}** correct numbers, ruined the count **${s.ruined}** time${s.ruined === 1 ? '' : 's'}.`); }
        const top = fun.counting.top(guild.id, 5);
        return respond(interaction, [`🔢 **Counting** ${c.channelId ? `in <#${c.channelId}>` : '(off)'}`, `Current number: **${c.current}** · next: **${c.current + 1}**`, `Record: **${c.record}** 🏆`,
            ...(top.length ? ['', '**Top counters**', ...top.map((t, i) => `${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} <@${t.userId}> — ${t.correct} (ruined ${t.ruined}×)`)] : [])].join('\n'));
    },
};
