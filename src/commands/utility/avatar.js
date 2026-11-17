const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { respond } = require('../../moderation/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('avatar')
        .setDescription("Show someone's profile picture, big.")
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('The member (default: you)')),

    async execute(interaction) {
        const user = interaction.options.getUser('user') ?? interaction.user;
        const member = interaction.options.getMember?.('user') ?? (user.id === interaction.user.id ? interaction.member : null);
        const globalUrl = user.displayAvatarURL({ size: 1024 });
        const serverUrl = member?.avatar ? member.displayAvatarURL({ size: 1024 }) : null; // only when they set a server-specific picture
        const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`${user.username}'s avatar`).setImage(serverUrl ?? globalUrl)
            .setDescription(serverUrl ? `[Server avatar](${serverUrl}) · [Profile avatar](${globalUrl})` : `[Open full size](${globalUrl})`);
        return respond(interaction, null, { embeds: [embed] });
    },
};
