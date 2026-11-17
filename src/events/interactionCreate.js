const { Events, MessageFlags, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const { checkCommandAccess, isBlocked } = require('../access/accessFlow');

// Replies with a safe message when something goes wrong.
async function replyWithError(interaction, text) {
    const message = { content: text, allowedMentions: { parse: [] } };
    try {
        if (interaction.replied || interaction.deferred) await interaction.followUp(message);
        else await interaction.reply(message);
    } catch (replyError) {
        logger.error('Could not send the error reply:', replyError.message);
    }
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        // Typing help for options that suggest values (for example the command name in /commandrules).
        if (interaction.isAutocomplete?.()) {
            const target = interaction.client.commands.get(interaction.commandName);
            if (target?.autocomplete && !isBlocked(interaction.client, interaction.user.id)) { try { await target.autocomplete(interaction); } catch (error) { logger.warn(`Autocomplete failed: ${error.message}`); } }
            return;
        }

        // People the bot owner blocked cannot use anything.
        if (isBlocked(interaction.client, interaction.user?.id)) {
            try { await interaction.reply({ content: 'You are blocked from using this bot.', flags: MessageFlags.Ephemeral }); } catch { /* ignore */ }
            return;
        }

        // Buttons, menus and forms. Each system registers a "prefix" (the part of the button's
        // ID before the first colon), for example "an" for anti-nuke. See index.js.
        if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
            const prefix = interaction.customId.split(':')[0];
            const handler = interaction.client.componentHandlers?.get(prefix);
            if (!handler) return;
            try {
                await handler(interaction);
            } catch (error) {
                logger.error(`Error in component handler "${prefix}":`, error);
                await replyWithError(interaction, 'Something went wrong while handling that button.');
            }
            return;
        }

        // Slash commands
        if (!interaction.isChatInputCommand()) return;

        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) {
            logger.warn(`No command found for /${interaction.commandName}`);
            return;
        }

        // Server rules from /commandrules (switched off, wrong channel, wrong role).
        const denied = interaction.guild ? checkCommandAccess(interaction.client, { guild: interaction.guild, member: interaction.member, channel: interaction.channel, commandName: interaction.commandName, userId: interaction.user.id, isAdmin: interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator) }) : null;
        if (denied) { await replyWithError(interaction, denied); return; }

        try {
            await command.execute(interaction);
        } catch (error) {
            logger.error(`Error while running /${interaction.commandName}:`, error);
            await replyWithError(interaction, 'Something went wrong while running that command.');
        }
    },
};
