const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { LOG_CATEGORIES, CATEGORY_NAMES } = require('../../logging/categories');

const categoryChoices = CATEGORY_NAMES.map((name) => ({ name, value: name }));
const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('logs')
        .setDescription('Choose where each kind of log is sent, and what to ignore.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('view').setDescription('Show the current log setup.'))
        .addSubcommand((s) =>
            s
                .setName('set')
                .setDescription('Send one kind of log to a channel.')
                .addStringOption((o) =>
                    o.setName('category').setDescription('Which kind of log').setRequired(true).addChoices(...categoryChoices)
                )
                .addChannelOption((o) =>
                    o.setName('channel').setDescription('A text channel').addChannelTypes(...TEXT_TYPES).setRequired(true)
                )
        )
        .addSubcommand((s) =>
            s
                .setName('set-all')
                .setDescription('Send every kind of log to one channel.')
                .addChannelOption((o) =>
                    o.setName('channel').setDescription('A text channel').addChannelTypes(...TEXT_TYPES).setRequired(true)
                )
        )
        .addSubcommand((s) =>
            s
                .setName('clear')
                .setDescription('Stop using a separate channel for one kind of log.')
                .addStringOption((o) =>
                    o.setName('category').setDescription('Which kind of log').setRequired(true).addChoices(...categoryChoices)
                )
        )
        .addSubcommand((s) =>
            s
                .setName('ignore')
                .setDescription('Never log activity from a channel, role or user.')
                .addChannelOption((o) => o.setName('channel').setDescription('A channel to ignore'))
                .addRoleOption((o) => o.setName('role').setDescription('A role to ignore'))
                .addUserOption((o) => o.setName('user').setDescription('A user to ignore'))
        )
        .addSubcommand((s) =>
            s
                .setName('unignore')
                .setDescription('Start logging a channel, role or user again.')
                .addChannelOption((o) => o.setName('channel').setDescription('A channel'))
                .addRoleOption((o) => o.setName('role').setDescription('A role'))
                .addUserOption((o) => o.setName('user').setDescription('A user'))
        ),

    async execute(interaction) {
        const reply = (content) =>
            interaction.reply({ content, allowedMentions: { parse: [] } });

        // Re-check permission on the server side. Never trust the command menu alone.
        if (!interaction.inGuild() || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return reply('You need the **Manage Server** permission to use this command.');
        }

        const { logConfig, guildSettings } = interaction.client.services;
        const guildId = interaction.guildId;
        const sub = interaction.options.getSubcommand();

        // Make sure the bot can really post in a channel before we accept it.
        async function checkChannel(channel) {
            const me = await interaction.guild.members.fetchMe();
            const perms = channel.permissionsFor(me);
            const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
            return perms?.has(needed) ? null : `I need **View Channel**, **Send Messages** and **Embed Links** in ${channel}.`;
        }

        if (sub === 'view') {
            const channels = logConfig.listChannels(guildId);
            const fallback = guildSettings.getSettings(guildId).logChannelId;
            const rows = CATEGORY_NAMES.map((name) => {
                const own = channels[name];
                const where = own ? `<#${own}>` : fallback ? `<#${fallback}> *(general log channel)*` : '*not set*';
                return `**${name}** → ${where}\n-# ${LOG_CATEGORIES[name]}`;
            });
            const ignores = logConfig.listIgnores(guildId);
            const ignoreText = ignores.length
                ? ignores.map((i) => (i.kind === 'channel' ? `<#${i.targetId}>` : i.kind === 'role' ? `<@&${i.targetId}>` : `<@${i.targetId}>`)).join(' ')
                : '*nothing*';
            return reply(`**Log setup**\n${rows.join('\n')}\n\n**Ignored:** ${ignoreText}`);
        }

        if (sub === 'set') {
            const channel = interaction.options.getChannel('channel', true);
            const problem = await checkChannel(channel);
            if (problem) return reply(problem);
            const category = interaction.options.getString('category', true);
            logConfig.setChannel(guildId, category, channel.id);
            return reply(`✅ **${category}** logs will go to ${channel}.`);
        }

        if (sub === 'set-all') {
            const channel = interaction.options.getChannel('channel', true);
            const problem = await checkChannel(channel);
            if (problem) return reply(problem);
            // "automod" is left out on purpose: auto-moderation logs stay apart from everything else.
            for (const category of CATEGORY_NAMES.filter((name) => name !== 'automod')) logConfig.setChannel(guildId, category, channel.id);
            return reply(`✅ All logs will go to ${channel}. (Auto-moderation logs are kept apart: set them with \`/logs set category:automod\`.)`);
        }

        if (sub === 'clear') {
            const category = interaction.options.getString('category', true);
            const removed = logConfig.clearChannel(guildId, category);
            return reply(removed ? `✅ **${category}** now uses the general log channel.` : `**${category}** had no separate channel.`);
        }

        // ignore / unignore: exactly one of channel, role or user
        const channel = interaction.options.getChannel('channel');
        const role = interaction.options.getRole('role');
        const user = interaction.options.getUser('user');
        const picked = [['channel', channel], ['role', role], ['user', user]].filter(([, value]) => value);
        if (picked.length !== 1) return reply('Pick exactly one of: channel, role or user.');

        const [kind, target] = picked[0];
        if (sub === 'ignore') {
            logConfig.addIgnore(guildId, kind, target.id);
            return reply(`✅ Activity from that ${kind} will no longer be logged.`);
        }
        const removed = logConfig.removeIgnore(guildId, kind, target.id);
        return reply(removed ? `✅ That ${kind} will be logged again.` : `That ${kind} was not being ignored.`);
    },
};
