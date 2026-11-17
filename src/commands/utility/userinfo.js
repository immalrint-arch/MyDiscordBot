const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { respond } = require('../../moderation/helpers');

const unix = (ms) => Math.floor(ms / 1000);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Show information about a member.')
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('The member (default: you)')),

    async execute(interaction) {
        const user = interaction.options.getUser('user') ?? interaction.user;
        const member = interaction.options.getMember?.('user') ?? (user.id === interaction.user.id ? interaction.member : await interaction.guild.members.fetch(user.id).catch(() => null));
        const embed = new EmbedBuilder().setColor(member?.displayColor || 0x5865f2).setTitle(user.username)
            .setThumbnail((member ?? user).displayAvatarURL({ size: 256 }))
            .addFields(
                { name: 'ID', value: `\`${user.id}\``, inline: true },
                { name: 'Type', value: user.bot ? '🤖 Bot' : '👤 Member', inline: true },
                { name: 'Account created', value: `<t:${unix(user.createdTimestamp)}:D> (<t:${unix(user.createdTimestamp)}:R>)` },
            );
        if (member) {
            if (member.nickname) embed.addFields({ name: 'Nickname', value: member.nickname.slice(0, 100), inline: true });
            if (member.joinedTimestamp) embed.addFields({ name: 'Joined server', value: `<t:${unix(member.joinedTimestamp)}:D> (<t:${unix(member.joinedTimestamp)}:R>)` });
            const roles = member.roles.cache.filter((r) => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position);
            embed.addFields({ name: `Roles (${roles.size})`, value: roles.size ? roles.map((r) => `<@&${r.id}>`).slice(0, 15).join(' ') + (roles.size > 15 ? ` …+${roles.size - 15}` : '') : 'None' });
            if (member.communicationDisabledUntilTimestamp > Date.now()) embed.addFields({ name: 'Timed out until', value: `<t:${unix(member.communicationDisabledUntilTimestamp)}:R>` });
        } else embed.setFooter({ text: 'Not in this server' });
        return respond(interaction, null, { embeds: [embed] });
    },
};
