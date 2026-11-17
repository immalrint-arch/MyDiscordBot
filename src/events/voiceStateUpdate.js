const { Events } = require('discord.js');
const { COLORS, logEmbed, footerForUser } = require('../logging/style');

// Voice activity: joins, leaves, moves, and mute/deafen changes.
module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        const member = newState.member ?? oldState.member;
        if (!member || !member.guild) return;
        const { logs } = member.client.services;
        const user = member.user;
        const id = `<@${user.id}>`;

        let title;
        let headline;
        let color = COLORS.blue;

        if (!oldState.channelId && newState.channelId) {
            title = 'Voice Joined';
            headline = `${id} joined <#${newState.channelId}>.`;
            color = COLORS.green;
        } else if (oldState.channelId && !newState.channelId) {
            title = 'Voice Left';
            headline = `${id} left <#${oldState.channelId}>.`;
            color = COLORS.red;
        } else if (oldState.channelId !== newState.channelId) {
            title = 'Voice Moved';
            headline = `${id} moved from <#${oldState.channelId}> to <#${newState.channelId}>.`;
        } else if (oldState.serverMute !== newState.serverMute) {
            title = newState.serverMute ? 'Server Muted' : 'Server Unmuted';
            headline = `${id} was ${newState.serverMute ? 'muted' : 'unmuted'} by a moderator in <#${newState.channelId}>.`;
            color = newState.serverMute ? COLORS.yellow : COLORS.green;
        } else if (oldState.serverDeaf !== newState.serverDeaf) {
            title = newState.serverDeaf ? 'Server Deafened' : 'Server Undeafened';
            headline = `${id} was ${newState.serverDeaf ? 'deafened' : 'undeafened'} by a moderator in <#${newState.channelId}>.`;
            color = newState.serverDeaf ? COLORS.yellow : COLORS.green;
        } else if (oldState.selfMute !== newState.selfMute) {
            title = newState.selfMute ? 'Self Muted' : 'Self Unmuted';
            headline = `${id} ${newState.selfMute ? 'muted' : 'unmuted'} themselves in <#${newState.channelId}>.`;
        } else if (oldState.selfDeaf !== newState.selfDeaf) {
            title = newState.selfDeaf ? 'Self Deafened' : 'Self Undeafened';
            headline = `${id} ${newState.selfDeaf ? 'deafened' : 'undeafened'} themselves in <#${newState.channelId}>.`;
        } else {
            return; // camera, streaming, etc. are not logged
        }

        const embed = logEmbed({
            color,
            title,
            headline,
            footer: footerForUser(user, new Date()),
            thumbnailUrl: user.displayAvatarURL({ size: 256 }),
        });
        await logs.send(member.guild, 'voice', { embeds: [embed] }, {
            userId: user.id,
            channelId: newState.channelId ?? oldState.channelId,
        });
    },
};
