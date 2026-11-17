const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond, describeError } = require('../../moderation/helpers');
const { cleanDisplayName, canControlRoom } = require('../../channels/channelRules');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voice')
        .setDescription('Control your temporary voice room.')
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('rename').setDescription('Rename your room.')
            .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(60)))
        .addSubcommand((s) => s.setName('limit').setDescription('Set how many people fit (0 = no limit).')
            .addIntegerOption((o) => o.setName('size').setDescription('0 to 99').setRequired(true).setMinValue(0).setMaxValue(99)))
        .addSubcommand((s) => s.setName('lock').setDescription('Stop new people joining.'))
        .addSubcommand((s) => s.setName('unlock').setDescription('Let people join again.'))
        .addSubcommand((s) => s.setName('transfer').setDescription('Give your room to someone inside it.')
            .addUserOption((o) => o.setName('member').setDescription('New owner').setRequired(true)))
        .addSubcommand((s) => s.setName('claim').setDescription('Take over a room whose owner left.')),

    async execute(interaction) {
        const { channels } = interaction.client.services;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        const voiceChannel = interaction.member.voice?.channel;
        const room = voiceChannel ? channels.getRoom(voiceChannel.id) : null;
        if (!room) return respond(interaction, 'Join one of the temporary rooms first, then use this command.');

        const hasManage = interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels);
        try {
            if (sub === 'claim') {
                if (voiceChannel.members.has(room.ownerId)) return respond(interaction, 'The owner is still in the room.');
                channels.setRoomOwner(room.channelId, interaction.user.id);
                await voiceChannel.permissionOverwrites.edit(interaction.user.id, { ManageChannels: true, MoveMembers: true, Connect: true });
                return respond(interaction, `👑 <@${interaction.user.id}> now owns **${voiceChannel.name}**.`);
            }
            if (!canControlRoom({ room, userId: interaction.user.id, hasManageChannels: hasManage })) return respond(interaction, 'Only the owner of this room can do that.');
            const reason = `Temporary room control by ${interaction.user.tag}`;
            if (sub === 'rename') {
                const name = cleanDisplayName(interaction.options.getString('name', true));
                if (!name) return respond(interaction, 'That name has no usable letters.');
                await voiceChannel.setName(name, reason);
                return respond(interaction, `✅ Renamed to **${name}**.`);
            }
            if (sub === 'limit') {
                const size = interaction.options.getInteger('size', true);
                await voiceChannel.setUserLimit(size, reason);
                return respond(interaction, size ? `✅ Room size is now **${size}**.` : '✅ The room has no size limit.');
            }
            if (sub === 'lock' || sub === 'unlock') {
                await voiceChannel.permissionOverwrites.edit(guild.id, { Connect: sub === 'lock' ? false : null }, { reason });
                return respond(interaction, sub === 'lock' ? '🔒 Room locked. People already inside can stay.' : '🔓 Room unlocked.');
            }
            if (sub === 'transfer') {
                const user = interaction.options.getUser('member', true);
                if (user.bot) return respond(interaction, 'Bots cannot own rooms.');
                if (!voiceChannel.members.has(user.id)) return respond(interaction, 'That person must be inside the room.');
                channels.setRoomOwner(room.channelId, user.id);
                await voiceChannel.permissionOverwrites.edit(user.id, { ManageChannels: true, MoveMembers: true, Connect: true }, { reason });
                if (room.ownerId !== user.id) await voiceChannel.permissionOverwrites.delete(room.ownerId, reason).catch(() => {});
                return respond(interaction, `👑 <@${user.id}> now owns **${voiceChannel.name}**.`);
            }
        } catch (error) {
            return respond(interaction, `⚠️ ${describeError(error)}`);
        }
    },
};
