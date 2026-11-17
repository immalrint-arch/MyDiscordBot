const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const logger = require('../utils/logger');
const { MAX_LENGTH, pickColor } = require('./confessionRules');
const { ConfessionServiceError } = require('../services/confessionService');

const PRIVATE = MessageFlags.Ephemeral; // anonymity needs a private reply: a public one would show "X used /confess"
const NOBODY = { parse: [] };

const confessButton = () => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cf:new').setLabel('Confess').setEmoji('💬').setStyle(ButtonStyle.Primary));

// The message in the channel (reference image): title, the text in quotes, a coloured side bar, and the Confess button.
function confessionPayload(number, text, color) {
    return {
        embeds: [new EmbedBuilder().setColor(color).setTitle(`Anonymous Confession (#${number})`).setDescription(`"${text}"`)],
        components: [confessButton()], allowedMentions: NOBODY,
    };
}
function panelPayload() {
    return {
        embeds: [new EmbedBuilder().setColor(0x6c4ab6).setTitle('💬 Anonymous Confessions')
            .setDescription('Something on your mind? Press **Confess** or use `/confess`.\nYour message is posted by the bot. Nobody, including staff, is shown who wrote it.\nBe kind: staff can block people who abuse this.')],
        components: [confessButton()], allowedMentions: NOBODY,
    };
}

const isMod = (interaction) => Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages));

// Is this person allowed to confess HERE? Returns a message when not, otherwise null.
function whereProblem(interaction, config) {
    if (!config.channelId) return 'Confessions are not set up on this server.';
    if (interaction.channelId !== config.channelId && !isMod(interaction)) return `Confessions can only be sent in <#${config.channelId}>.`;
    return null;
}

const refuse = (interaction, content) => interaction.reply({ content, flags: PRIVATE, allowedMentions: NOBODY });

function openForm(interaction) {
    return interaction.showModal(new ModalBuilder().setCustomId('cf:submit').setTitle('Anonymous confession').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('text').setLabel('Your confession (posted anonymously)')
            .setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(MAX_LENGTH))));
}

// Used by /confess (text given), and by the form.
async function submitConfession(interaction, text, { rng = Math.random } = {}) {
    const { confessions } = interaction.client.services;
    const guild = interaction.guild;
    const config = confessions.getConfig(guild.id);
    const where = whereProblem(interaction, config);
    if (where) return refuse(interaction, where);
    await interaction.deferReply({ flags: PRIVATE });
    let record = null;
    try {
        record = confessions.create(guild.id, interaction.user.id, text);
        const channel = await guild.channels.fetch(config.channelId).catch(() => null);
        if (!channel?.isTextBased?.()) { confessions.discard(guild.id, record.number); return interaction.editReply('I cannot reach the confession channel right now. Please tell an admin.'); }
        const sent = await channel.send(confessionPayload(record.number, record.content, pickColor(rng))).catch((error) => { logger.warn(`Confession post failed in server ${guild.id}: ${error.message}`); return null; });
        if (!sent) { confessions.discard(guild.id, record.number); return interaction.editReply('I cannot post in the confession channel. Please tell an admin.'); }
        confessions.attachMessage(guild.id, record.number, channel.id, sent.id);
        return interaction.editReply(`✅ Your confession was posted anonymously as **#${record.number}**.`);
    } catch (error) {
        if (error instanceof ConfessionServiceError) return interaction.editReply(`⚠️ ${error.message}`);
        logger.error(`confession failed in server ${guild.id}:`, error);
        if (record) confessions.discard(guild.id, record.number);
        return interaction.editReply('Something went wrong. Nothing was posted.');
    }
}

// "cf:new" button and "cf:submit" form.
async function handleConfessionComponent(interaction) {
    const { confessions } = interaction.client.services;
    if (interaction.isModalSubmit()) return submitConfession(interaction, interaction.fields.getTextInputValue('text'));
    if (interaction.customId !== 'cf:new') return;
    const config = confessions.getConfig(interaction.guildId);
    const where = whereProblem(interaction, config);
    if (where) return refuse(interaction, where);
    try { confessions.check(interaction.guildId, interaction.user.id); } catch (error) {
        if (error instanceof ConfessionServiceError) return refuse(interaction, `⚠️ ${error.message}`);
        throw error;
    }
    return openForm(interaction);
}

module.exports = { confessionPayload, panelPayload, whereProblem, submitConfession, openForm, handleConfessionComponent, refuse, isMod, PRIVATE };
