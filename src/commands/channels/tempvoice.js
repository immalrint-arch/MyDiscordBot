const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { cleanDisplayName } = require('../../channels/channelRules');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tempvoice')
        .setDescription('Temporary voice rooms: join a trigger channel and get your own room.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('setup').setDescription('Choose the trigger channel and switch rooms on.')
            .addChannelOption((o) => o.setName('trigger').setDescription('Joining this voice channel creates a room').setRequired(true).addChannelTypes(ChannelType.GuildVoice))
            .addChannelOption((o) => o.setName('category').setDescription('Where rooms are created (default: next to the trigger)').addChannelTypes(ChannelType.GuildCategory))
            .addStringOption((o) => o.setName('name').setDescription('Room name. Words: {displayname} {username} {number}').setMaxLength(60))
            .addIntegerOption((o) => o.setName('limit').setDescription('Default room size (0 = no limit)').setMinValue(0).setMaxValue(99)))
        .addSubcommand((s) => s.setName('enable').setDescription('Turn temporary rooms on.'))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn temporary rooms off.'))
        .addSubcommand((s) => s.setName('status').setDescription('Show the settings.')),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels'))) return;
        const { channels } = interaction.client.services;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        if (sub === 'setup') {
            const trigger = interaction.options.getChannel('trigger', true);
            const category = interaction.options.getChannel('category');
            const changes = { enabled: true, triggerChannelId: trigger.id, categoryId: category?.id ?? null };
            const name = interaction.options.getString('name');
            if (name) changes.nameTemplate = cleanDisplayName(name) || "{displayname}'s room";
            const limit = interaction.options.getInteger('limit');
            if (limit !== null) changes.defaultLimit = limit;
            channels.setVoiceConfig(guild.id, changes);
            const me = guild.members.me ?? await guild.members.fetchMe();
            const warn = me.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers]) ? '' : '\n⚠️ I still need **Manage Channels** and **Move Members**.';
            return respond(interaction, `✅ Temporary rooms are **on**. Joining <#${trigger.id}> creates a room. Owners control theirs with \`/voice\`.${warn}`);
        }
        if (sub === 'enable' || sub === 'disable') {
            const c = channels.getVoiceConfig(guild.id);
            if (sub === 'enable' && !c.triggerChannelId) return respond(interaction, 'Run `/tempvoice setup` first to choose a trigger channel.');
            channels.setVoiceConfig(guild.id, { enabled: sub === 'enable' });
            return respond(interaction, sub === 'enable' ? '✅ Temporary rooms are **on**.' : '⛔ Temporary rooms are **off**. Existing rooms stay until empty.');
        }
        const c = channels.getVoiceConfig(guild.id);
        return respond(interaction, [
            `Temporary rooms: ${c.enabled ? '✅ on' : '⛔ off'}`,
            `Trigger channel: ${c.triggerChannelId ? `<#${c.triggerChannelId}>` : 'not set'}`,
            `Category: ${c.categoryId ? `<#${c.categoryId}>` : 'next to the trigger'}`,
            `Room name: \`${c.nameTemplate}\``,
            `Default size: ${c.defaultLimit || 'no limit'}`,
            `Rooms open now: ${channels.countRooms(guild.id)}`,
        ].join('\n'));
    },
};
