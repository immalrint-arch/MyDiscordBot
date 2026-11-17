const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');

const PERM = PermissionFlagsBits.ManageGuild;
module.exports = {
    data: new SlashCommandBuilder().setName('fun').setDescription('Settings for the fun features (games, AFK, counting, birthdays).').setDMPermission(false)
        .setDefaultMemberPermissions(PERM)
        .addSubcommand((s) => s.setName('status').setDescription('Show which fun features are on.'))
        .addSubcommand((s) => s.setName('games').setDescription('Turn games on/off, or limit them to one channel.')
            .addBooleanOption((o) => o.setName('enabled').setDescription('Allow games (moderators can always play)'))
            .addChannelOption((o) => o.setName('channel').setDescription('Games only work in this channel').addChannelTypes(ChannelType.GuildText))
            .addBooleanOption((o) => o.setName('any-channel').setDescription('True = remove the channel limit')))
        .addSubcommand((s) => s.setName('afk').setDescription('Turn the /afk feature on or off.').addBooleanOption((o) => o.setName('enabled').setDescription('Allow AFK').setRequired(true))),
    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
        const { fun } = interaction.client.services; const id = interaction.guildId; const sub = interaction.options.getSubcommand();
        if (sub === 'games') {
            const patch = {}; const enabled = interaction.options.getBoolean('enabled'); const channel = interaction.options.getChannel('channel');
            if (enabled !== null) patch.gamesEnabled = enabled; if (channel) patch.gamesChannelId = channel.id; if (interaction.options.getBoolean('any-channel')) patch.gamesChannelId = null;
            if (Object.keys(patch).length) fun.setConfig(id, patch);
        } else if (sub === 'afk') fun.setConfig(id, { afkEnabled: interaction.options.getBoolean('enabled', true) });
        const c = fun.getConfig(id); const bd = fun.birthdays.getConfig(id); const ct = fun.counting.getConfig(id); const bm = fun.bump.getConfig(id);
        return respond(interaction, ['**🎉 Fun settings**', `Games: ${c.gamesEnabled ? '✅ on' : '⛔ off'}${c.gamesChannelId ? ` (only in <#${c.gamesChannelId}>)` : ' (any channel)'}`, `AFK: ${c.afkEnabled ? '✅ on' : '⛔ off'}`,
            `Counting: ${ct.channelId ? `✅ <#${ct.channelId}>` : '⬜ off (`/counting setup`)'}`, `Birthdays: ${bd.channelId ? `✅ <#${bd.channelId}>` : '⬜ no channel (`/birthday channel`)'}`, `Bump reminders: ${bm.channelId ? `✅ <#${bm.channelId}>` : '⬜ off (`/bump setup`)'}`].join('\n'));
    },
};
