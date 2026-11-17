const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { respond } = require('../../moderation/helpers');

const unix = (ms) => Math.floor(ms / 1000);

module.exports = {
    data: new SlashCommandBuilder().setName('serverinfo').setDescription('Show information about this server.').setDMPermission(false),

    async execute(interaction) {
        const g = interaction.guild;
        const channels = g.channels.cache;
        const count = (...types) => channels.filter((c) => types.includes(c.type)).size;
        const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(g.name)
            .setThumbnail(g.iconURL({ size: 256 }) ?? null)
            .addFields(
                { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
                { name: 'Members', value: String(g.memberCount), inline: true },
                { name: 'Created', value: `<t:${unix(g.createdTimestamp)}:D> (<t:${unix(g.createdTimestamp)}:R>)` },
                { name: 'Channels', value: `💬 ${count(ChannelType.GuildText, ChannelType.GuildAnnouncement)} · 🔊 ${count(ChannelType.GuildVoice, ChannelType.GuildStageVoice)} · 📁 ${count(ChannelType.GuildCategory)}`, inline: true },
                { name: 'Roles', value: String(Math.max(0, g.roles.cache.size - 1)), inline: true },
                { name: 'Emojis', value: String(g.emojis?.cache?.size ?? 0), inline: true },
                { name: 'Boosts', value: `Level ${g.premiumTier ?? 0} · ${g.premiumSubscriptionCount ?? 0} boost(s)`, inline: true },
                { name: 'ID', value: `\`${g.id}\``, inline: true },
            );
        return respond(interaction, null, { embeds: [embed] });
    },
};
