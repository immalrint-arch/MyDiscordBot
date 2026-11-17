const { Events } = require('discord.js');
const { COLORS, logEmbed, footerForUser } = require('../logging/style');
const { line, stamp } = require('../logging/textFormat');

// Reference image 14: "Invite Created".
module.exports = {
    name: Events.InviteCreate,
    async execute(invite) {
        const guild = invite.guild && invite.client.guilds.cache.get(invite.guild.id);
        if (!guild) return;
        const { logs } = invite.client.services;

        const hours = invite.maxAge ? `${Math.round(invite.maxAge / 3600)} hours` : 'Never';
        const lines = [
            line('Code', `\`${invite.code}\``),
            line('Channel', invite.channel ? `<#${invite.channel.id}>` : 'Unknown'),
            line('Created by', invite.inviter ? `<@${invite.inviter.id}>` : 'Unknown'),
            line('Expires in', hours),
            line('Max uses', invite.maxUses ? invite.maxUses : 'Unlimited'),
        ];
        const footer = invite.inviter
            ? footerForUser(invite.inviter, new Date())
            : [`Time: ${stamp(new Date(), 'f')}`, `Code \`${invite.code}\``];

        const embed = logEmbed({
            color: COLORS.blue,
            title: 'Invite Created',
            headline: invite.channel ? `A new invite link was created for <#${invite.channel.id}>.` : 'A new invite link was created.',
            lines,
            footer,
            thumbnailUrl: invite.inviter?.displayAvatarURL({ size: 256 }) ?? null,
        });
        await logs.send(guild, 'server', { embeds: [embed] }, { userId: invite.inviter?.id ?? null });
    },
};
