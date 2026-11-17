const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const logger = require('../../utils/logger');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { cleanText } = require('../../utils/text');
const { suggestionPayload } = require('../../utility/utilityFlow');

const ADMIN = PermissionFlagsBits.ManageGuild, MOD = PermissionFlagsBits.ManageMessages;
const number = (o) => o.setName('number').setDescription('The suggestion number').setRequired(true).setMinValue(1);
const note = (o) => o.setName('note').setDescription('A note shown on the suggestion').setMaxLength(500);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('suggestion')
        .setDescription('Manage suggestions.')
        .setDefaultMemberPermissions(MOD)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('setup').setDescription('Choose the suggestions channel. Needs Manage Server.')
            .addChannelOption((o) => o.setName('channel').setDescription('Where suggestions are posted').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn suggestions off. Needs Manage Server.'))
        .addSubcommand((s) => s.setName('approve').setDescription('Mark a suggestion as approved.').addIntegerOption(number).addStringOption(note))
        .addSubcommand((s) => s.setName('deny').setDescription('Mark a suggestion as denied.').addIntegerOption(number).addStringOption(note))
        .addSubcommand((s) => s.setName('consider').setDescription('Mark a suggestion as being considered (voting stays open).').addIntegerOption(number).addStringOption(note)),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const { suggestions } = interaction.client.services;
        const { guild } = interaction;
        const admin = ['setup', 'disable'].includes(sub);
        if (!(await ensureModerator(interaction, admin ? ADMIN : MOD, admin ? 'Manage Server' : 'Manage Messages'))) return;
        if (sub === 'setup') {
            const channel = interaction.options.getChannel('channel', true);
            const me = await guild.members.fetchMe();
            if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return respond(interaction, `I need View Channel, Send Messages and Embed Links in <#${channel.id}>.`);
            suggestions.setChannel(guild.id, channel.id);
            return respond(interaction, `✅ Suggestions go to <#${channel.id}>. Members use \`/suggest\`.`);
        }
        if (sub === 'disable') { suggestions.setChannel(guild.id, null); return respond(interaction, '⛔ Suggestions are off.'); }
        const n = interaction.options.getInteger('number', true);
        const status = { approve: 'approved', deny: 'denied', consider: 'considered' }[sub];
        const updated = suggestions.setStatus(guild.id, n, status, interaction.user.id, cleanText(interaction.options.getString('note'), 500));
        if (!updated) return respond(interaction, suggestions.get(guild.id, n) ? `Suggestion #${n} was already decided.` : `There is no suggestion #${n}.`);
        try {
            const channel = await guild.channels.fetch(updated.channelId).catch(() => null);
            const message = await channel?.messages.fetch(updated.messageId).catch(() => null);
            const author = await interaction.client.users.fetch(updated.authorId).catch(() => null);
            await message?.edit(suggestionPayload(updated, suggestions.counts(updated.id), author));
        } catch (error) { logger.warn(`Could not update suggestion message: ${error.message}`); }
        return respond(interaction, `✅ Suggestion #${n} marked as **${status}**.`);
    },
};
