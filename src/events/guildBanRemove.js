const { Events, AuditLogEvent } = require('discord.js');
const { COLORS, logEmbed, footerForUser, profileButton, actorText } = require('../logging/style');
const { line } = require('../logging/textFormat');

// Reference image 17: "Member Unbanned".
module.exports = {
    name: Events.GuildBanRemove,
    async execute(ban) {
        const { logs, audit, suppress } = ban.client.services;
        const { guild, user } = ban;

        if (suppress.isSuppressed(guild.id, 'unban', user.id)) return; // our own /unban or /softban

        const entry = await audit.findEntry(guild, AuditLogEvent.MemberBanRemove, { targetId: user.id });
        const embed = logEmbed({
            color: COLORS.green,
            title: 'Member Unbanned',
            headline: `<@${user.id}> was unbanned and can join the server again.`,
            lines: [line('Unbanned by', actorText(entry))],
            footer: footerForUser(user, new Date()),
            thumbnailUrl: user.displayAvatarURL({ size: 256 }),
        });

        await logs.send(guild, 'members', { embeds: [embed], components: [profileButton(user.id)] }, { userId: user.id });
    },
};
