const { Events, AuditLogEvent } = require('discord.js');
const { COLORS, logEmbed, footerForUser, profileButton, actorText } = require('../logging/style');
const { line } = require('../logging/textFormat');

// Reference image 17: "Member Banned".
module.exports = {
    name: Events.GuildBanAdd,
    async execute(ban) {
        const { logs, audit, suppress } = ban.client.services;
        const { guild, user } = ban;

        if (suppress.isSuppressed(guild.id, 'ban', user.id)) return; // our own /ban already logged it

        const entry = await audit.findEntry(guild, AuditLogEvent.MemberBanAdd, { targetId: user.id });
        const embed = logEmbed({
            color: COLORS.red,
            title: 'Member Banned',
            headline: `<@${user.id}> was banned from the server.`,
            lines: [
                line('Banned by', actorText(entry)),
                line('Reason', ban.reason ?? entry?.reason ?? 'No reason provided'),
            ],
            footer: footerForUser(user, new Date()),
            thumbnailUrl: user.displayAvatarURL({ size: 256 }),
        });

        await logs.send(guild, 'members', { embeds: [embed], components: [profileButton(user.id)] }, { userId: user.id });
    },
};
