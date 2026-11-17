const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const logger = require('../../utils/logger');
const { cleanReason } = require('../../utils/text');
const { actionLogEmbed } = require('../../utils/embeds');
const { respond, ensureModerator, fetchTargetMember, guardMember, auditReason, describeError } = require('../../moderation/helpers');

const P = PermissionFlagsBits;
const user = (o) => o.setName('user').setDescription('The member (must be in a voice channel)').setRequired(true);
const reason = (o) => o.setName('reason').setDescription('Why').setMaxLength(512);
// what each subcommand needs, how it is said, and what Discord call it makes
const ACTIONS = {
    kick: { perm: P.MoveMembers, label: 'Move Members', title: 'Voice kick', done: 'disconnected from voice', run: (m, r) => m.voice.disconnect(r) },
    mute: { perm: P.MuteMembers, label: 'Mute Members', title: 'Voice mute', done: 'muted in voice', run: (m, r) => m.voice.setMute(true, r), skipIf: (m) => m.voice.serverMute, skipText: 'already muted' },
    unmute: { perm: P.MuteMembers, label: 'Mute Members', title: 'Voice unmute', done: 'unmuted in voice', run: (m, r) => m.voice.setMute(false, r), skipIf: (m) => m.voice.serverMute === false, skipText: 'not muted' },
    deafen: { perm: P.DeafenMembers, label: 'Deafen Members', title: 'Voice deafen', done: 'deafened in voice', run: (m, r) => m.voice.setDeaf(true, r), skipIf: (m) => m.voice.serverDeaf, skipText: 'already deafened' },
    undeafen: { perm: P.DeafenMembers, label: 'Deafen Members', title: 'Voice undeafen', done: 'undeafened in voice', run: (m, r) => m.voice.setDeaf(false, r), skipIf: (m) => m.voice.serverDeaf === false, skipText: 'not deafened' },
    move: { perm: P.MoveMembers, label: 'Move Members', title: 'Voice move', done: 'moved', run: (m, r, ch) => m.voice.setChannel(ch, r) },
};

module.exports = {
    ACTIONS,
    data: new SlashCommandBuilder()
        .setName('vc')
        .setDescription('Voice moderation: kick, mute, deafen or move people in voice channels.')
        .setDefaultMemberPermissions(P.MoveMembers)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('kick').setDescription('Disconnect a member from voice.').addUserOption(user).addStringOption(reason))
        .addSubcommand((s) => s.setName('mute').setDescription('Server-mute a member in voice.').addUserOption(user).addStringOption(reason))
        .addSubcommand((s) => s.setName('unmute').setDescription('Remove a voice mute.').addUserOption(user).addStringOption(reason))
        .addSubcommand((s) => s.setName('deafen').setDescription('Server-deafen a member in voice.').addUserOption(user).addStringOption(reason))
        .addSubcommand((s) => s.setName('undeafen').setDescription('Remove a voice deafen.').addUserOption(user).addStringOption(reason))
        .addSubcommand((s) => s.setName('move').setDescription('Move a member to another voice channel.').addUserOption(user)
            .addChannelOption((o) => o.setName('channel').setDescription('Where to move them').setRequired(true).addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
            .addStringOption(reason)),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const action = ACTIONS[sub];
        if (!action) return respond(interaction, 'Unknown voice action.');
        if (!(await ensureModerator(interaction, action.perm, action.label))) return;
        await interaction.deferReply();
        const { guild } = interaction;
        const target = interaction.options.getUser('user', true);
        const why = cleanReason(interaction.options.getString('reason'));
        try {
            const me = await guild.members.fetchMe();
            if (!me.permissions.has(action.perm)) return respond(interaction, `I need the **${action.label}** permission to do that.`);
            const member = await fetchTargetMember(guild, target.id);
            if (!member) return respond(interaction, 'That user is not in this server.');
            if (!member.voice?.channelId) return respond(interaction, `**${target.username}** is not in a voice channel.`);
            const problem = guardMember(interaction, member, me, { botMustOutrank: false, actionLabel: 'moderate' });
            if (problem) return respond(interaction, problem);
            if (action.skipIf?.(member)) return respond(interaction, `**${target.username}** is ${action.skipText}.`);

            let destination = null;
            if (sub === 'move') {
                destination = interaction.options.getChannel('channel', true);
                if (destination.id === member.voice.channelId) return respond(interaction, 'They are already in that channel.');
                if (!destination.permissionsFor(me)?.has([P.ViewChannel, P.Connect, P.MoveMembers])) return respond(interaction, 'I cannot connect to that channel. Give me View, Connect and Move Members there.');
            }
            const from = member.voice.channel;
            await action.run(member, auditReason(interaction, why), destination);

            await interaction.client.services.modLog.send(guild, { embeds: [actionLogEmbed({ title: action.title, moderatorId: interaction.user.id, fields: [
                { name: 'User', value: `<@${target.id}> (\`${target.id}\`)`, inline: true },
                { name: 'Channel', value: sub === 'move' ? `<#${from.id}> → <#${destination.id}>` : `<#${from.id}>`, inline: true },
                { name: 'Reason', value: why ?? 'No reason provided' }] })] });
            return respond(interaction, `✅ **${target.username}** was ${action.done}${sub === 'move' ? ` to <#${destination.id}>` : ''}.`);
        } catch (error) {
            logger.error(`vc ${sub} failed in server ${guild.id}:`, error);
            return respond(interaction, `I couldn't do that: ${describeError(error)}.`);
        }
    },
};
