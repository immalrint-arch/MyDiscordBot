const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags,
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription("View or change this server's bot settings.")
        // Discord hides the command from people without "Manage Server" by default.
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        // Only usable inside servers, not in direct messages.
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub.setName('view').setDescription('Show the current settings.')
        )
        .addSubcommand((sub) =>
            sub
                .setName('set-log-channel')
                .setDescription('Choose the channel where the bot sends moderation logs.')
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('A text channel')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub.setName('clear-log-channel').setDescription('Stop using a log channel.')
        )
        .addSubcommand((sub) =>
            sub
                .setName('set-appeal-channel')
                .setDescription('Choose the (moderator-only) channel where ban appeals arrive.')
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('A text channel only moderators can see')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub.setName('clear-appeal-channel').setDescription('Send appeals to the moderation log channel instead.')
        )
        .addSubcommand((sub) =>
            sub
                .setName('dm-on-action')
                .setDescription('Choose whether members get a private message when they are moderated.')
                .addBooleanOption((option) =>
                    option
                        .setName('enabled')
                        .setDescription('True = send a private message, False = stay silent')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        // Server admins can change who sees a command, so we ALWAYS re-check
        // permissions here instead of trusting Discord's menu alone.
        if (!interaction.inGuild()) {
            return interaction.reply({
                content: 'This command only works inside a server.',
            });
        }
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
                content: 'You need the **Manage Server** permission to use this command.',
            });
        }

        const { guildSettings } = interaction.client.services;
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'view') {
            const settings = guildSettings.getSettings(interaction.guildId);
            const logChannel = settings.logChannelId ? `<#${settings.logChannelId}>` : 'Not set';
            const dm = settings.dmOnAction ? 'On' : 'Off';
            return interaction.reply({
                content: `**Settings for this server**\nLog channel: ${logChannel}\nAppeal channel: ${settings.appealChannelId ? `<#${settings.appealChannelId}>` : 'Not set (uses the moderation log channel)'}\nPrivate message on moderation: ${dm}`,
            });
        }

        if (subcommand === 'set-log-channel') {
            const channel = interaction.options.getChannel('channel', true);

            // Make sure the bot can actually use that channel before saving it.
            const me = await interaction.guild.members.fetchMe();
            const permissions = channel.permissionsFor(me);
            if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
                return interaction.reply({
                    content: `I can't send messages in ${channel}. Give me **View Channel** and **Send Messages** there first.`,
                });
            }

            guildSettings.updateSetting(interaction.guildId, 'logChannelId', channel.id);
            return interaction.reply({
                content: `Log channel set to ${channel}.`,
            });
        }

        if (subcommand === 'set-appeal-channel') {
            const channel = interaction.options.getChannel('channel', true);
            const me = await interaction.guild.members.fetchMe();
            if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
                return interaction.reply({ content: `I can't post in ${channel}. Give me **View Channel**, **Send Messages** and **Embed Links** there first.` });
            }
            guildSettings.updateSetting(interaction.guildId, 'appealChannelId', channel.id);
            return interaction.reply({ content: `Ban appeals will now arrive in ${channel}.` });
        }

        if (subcommand === 'clear-appeal-channel') {
            guildSettings.updateSetting(interaction.guildId, 'appealChannelId', null);
            return interaction.reply({ content: 'Appeals will now go to the moderation log channel.' });
        }

        if (subcommand === 'clear-log-channel') {
            guildSettings.updateSetting(interaction.guildId, 'logChannelId', null);
            return interaction.reply({
                content: 'Log channel cleared.',
            });
        }

        if (subcommand === 'dm-on-action') {
            const enabled = interaction.options.getBoolean('enabled', true);
            guildSettings.updateSetting(interaction.guildId, 'dmOnAction', enabled);
            return interaction.reply({
                content: enabled
                    ? 'Members will now get a private message when they are warned, timed out, kicked or banned.'
                    : 'Members will no longer get private messages about moderation.',
            });
        }
    },
};
