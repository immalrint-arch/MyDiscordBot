const { Events } = require('discord.js');
const { COLORS, logEmbed, footerForUser, profileButton } = require('../logging/style');
const { line, dateWithAgo, isNewAccount } = require('../logging/textFormat');

// Reference images 1 and 19: "Member Joined", with a warning for brand-new accounts.
module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        const { logs } = member.client.services;
        const user = member.user;
        const fresh = isNewAccount(user.createdTimestamp);

        let headline = `<@${user.id}> just joined the server.`;
        if (user.bot) headline += '\n🤖 This account is a **bot**.';
        if (fresh) {
            headline +=
                '\n⚠️ **Brand-new account** — created less than a day ago. ' +
                'Spammers and raiders often use fresh accounts, so it\'s worth a quick look.';
        }

        const embed = logEmbed({
            color: fresh ? COLORS.yellow : COLORS.green,
            title: fresh ? '📥 Member Joined' : 'Member Joined',
            headline,
            lines: [
                line('Account created', dateWithAgo(user.createdTimestamp)),
                line('Members now', member.guild.memberCount),
            ],
            footer: footerForUser(user, new Date()),
            thumbnailUrl: user.displayAvatarURL({ size: 256 }),
        });

        await logs.send(member.guild, 'members', { embeds: [embed], components: [profileButton(user.id)] }, { userId: user.id });
    },
};
