const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../moderation/helpers');
const { cleanText } = require('../../utils/text');
const { MAX_AFK_REASON } = require('../../fun/rules');

module.exports = {
    data: new SlashCommandBuilder().setName('afk').setDescription('Mark yourself away. I tell people who mention you, and clear it when you chat again.').setDMPermission(false)
        .addStringOption((o) => o.setName('reason').setDescription('Why you are away (optional)').setMaxLength(MAX_AFK_REASON)),
    async execute(interaction) {
        const { fun } = interaction.client.services;
        if (!fun.getConfig(interaction.guildId).afkEnabled) return respond(interaction, 'AFK is switched off in this server.');
        const reason = cleanText(interaction.options.getString('reason') ?? '', MAX_AFK_REASON) ?? 'AFK';
        fun.afk.set(interaction.guildId, interaction.user.id, reason);
        return respond(interaction, `💤 <@${interaction.user.id}> I set your AFK: **${reason}**\nI will clear it the next time you send a message.`);
    },
};
