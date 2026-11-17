const { Events, AuditLogEvent } = require('discord.js');
const { COLORS, logEmbed, footerForUser, profileButton, actorText } = require('../logging/style');
const { line, dateWithAgo } = require('../logging/textFormat');

// Reference images 4 and 16: "Member Left" or "Member Kicked".
// Discord sends the same event for leaving, being kicked AND being banned,
// so we use the audit log to tell them apart.
module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        const { logs, audit, suppress } = member.client.services;
        const { guild, user } = member;

        // Our own /kick, /ban and /softban commands already logged this.
        if (suppress.isSuppressed(guild.id, 'leave', user.id)) return;

        const kick = await audit.findEntry(guild, AuditLogEvent.MemberKick, { targetId: user.id, attempts: 2 });
        if (!kick) {
            // A ban also triggers this event. The ban event logs it, so skip it here.
            const ban = await audit.findEntry(guild, AuditLogEvent.MemberBanAdd, { targetId: user.id, attempts: 1 });
            if (ban) return;
        }

        const roles = member.roles?.cache
            ? [...member.roles.cache.values()].filter((r) => r.id !== guild.id).map((r) => `<@&${r.id}>`)
            : [];

        const lines = [];
        if (member.joinedTimestamp) lines.push(line('Joined the server', dateWithAgo(member.joinedTimestamp)));
        lines.push(line('Members now', guild.memberCount));
        if (roles.length) lines.push(line('Roles they had', roles.slice(0, 20).join(' ')));
        if (kick) {
            lines.push(line('Kicked by', actorText(kick)));
            lines.push(line('Reason', kick.reason ?? 'No reason provided'));
        }

        const embed = logEmbed({
            color: kick ? COLORS.yellow : COLORS.red,
            title: kick ? 'Member Kicked' : 'Member Left',
            headline: kick ? `<@${user.id}> was kicked from the server.` : `<@${user.id}> left the server.`,
            lines,
            footer: footerForUser(user, new Date()),
            thumbnailUrl: user.displayAvatarURL({ size: 256 }),
        });

        await logs.send(guild, 'members', { embeds: [embed], components: [profileButton(user.id)] }, { userId: user.id });
    },
};
