// Custom commands (tags) and auto-responders.
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const R = require('./rules');
const { respond, ensureModerator } = require('../moderation/helpers');
const { BUILTIN_ALIASES } = require('../textcommands/builtinAliases');
const { TextCommandUnsupported } = require('../textcommands/adapter');
const { CustomServiceError } = require('../services/customService');

const PERM = PermissionFlagsBits.ManageGuild;
const NOBODY = { parse: [], repliedUser: false };
const cooldowns = new Map();
function cooldownOk(kind, userId, ms, nowMs = Date.now()) {
    const key = `${kind}:${userId}`; if (nowMs - (cooldowns.get(key) ?? 0) < ms) return false;
    if (cooldowns.size > 5000) for (const [k, t] of cooldowns) if (nowMs - t > 60000) cooldowns.delete(k);
    cooldowns.set(key, nowMs); return true;
}
// A custom command must never hide a real command.
const isReserved = (client, name) => client.commands.has(name) || Boolean(BUILTIN_ALIASES[name]) || ['help', 'tag'].includes(name);
const ctxFor = (guild, user, channelId, args = '') => ({ userId: user.id, username: user.username ?? 'Member', server: guild.name, channel: channelId, members: guild.memberCount, args });

function textModal(action, name, current = '') {
    const input = new TextInputBuilder().setCustomId('text').setLabel('What should I reply?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(1).setMaxLength(R.MAX_RESPONSE).setPlaceholder('You can use {user} {username} {server} {channel} {members} {args}');
    if (current) input.setValue(current.slice(0, R.MAX_RESPONSE));
    return new ModalBuilder().setCustomId(`tg:${action}:${name}`).setTitle(`${action === 'edit' ? 'Edit' : 'Create'} command: ${name}`.slice(0, 45)).addComponents(new ActionRowBuilder().addComponents(input));
}

// ---------- /tag ----------
async function handleTagCommand(interaction) {
    const { custom } = interaction.client.services; const sub = interaction.options.getSubcommand(); const { guild, user } = interaction; const o = interaction.options;
    const nameIn = () => String(o.getString('name', true)).trim().toLowerCase().replace(/^!+/, '');
    if (sub === 'use') {
        const name = nameIn(); const tag = custom.tags.get(guild.id, name);
        if (!tag) return respond(interaction, `There is no custom command named **${name}**. See \`/tag list\`.`);
        if (!cooldownOk('tag', user.id, 2500)) return respond(interaction, 'Please wait a moment before using another command.');
        custom.tags.use(guild.id, name);
        return respond(interaction, R.render(tag.response, ctxFor(guild, user, interaction.channelId)), { allowedMentions: { parse: [] } });
    }
    if (sub === 'list') {
        const tags = custom.tags.list(guild.id);
        return respond(interaction, tags.length ? `**Custom commands (${tags.length})**\n${tags.map((t) => `\`${t.name}\``).join(', ')}\nUse one with \`/tag use name:…\`${interaction.client.services.textCommands.getConfig(guild.id).enabled ? ` or type \`${interaction.client.services.textCommands.getConfig(guild.id).prefix}name\`` : ''}.`.slice(0, 1900) : 'There are no custom commands yet. Staff can add one with `/tag create`.');
    }
    if (sub === 'info') {
        const name = nameIn(); const t = custom.tags.get(guild.id, name); if (!t) return respond(interaction, `There is no custom command named **${name}**.`);
        return respond(interaction, `**${t.name}** · used ${t.uses} time${t.uses === 1 ? '' : 's'} · created by <@${t.createdBy}> <t:${Math.floor(t.createdAt / 1000)}:R>${t.updatedAt !== t.createdAt ? ` · edited <t:${Math.floor(t.updatedAt / 1000)}:R>` : ''}\n\`\`\`\n${t.response.replace(/```/g, "'''").slice(0, 1500)}\n\`\`\``);
    }
    if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
    try {
        if (sub === 'delete') { const name = nameIn(); return respond(interaction, custom.tags.remove(guild.id, name) ? `🗑️ Deleted the command **${name}**.` : `There is no custom command named **${name}**.`); }
        const name = nameIn(); const response = o.getString('response');
        if (sub === 'create' && isReserved(interaction.client, name)) return respond(interaction, `**${name}** is the name of a built-in command, so it cannot be used. Pick another name.`);
        if (sub === 'create' && !/^[a-z0-9_-]{1,32}$/.test(name)) return respond(interaction, 'A name can use letters a-z, numbers, - and _ (1 to 32 characters), with no spaces.');
        if (response == null) {
            if (sub === 'edit' && !custom.tags.get(guild.id, name)) return respond(interaction, `There is no custom command named **${name}**.`);
            if (sub === 'create' && custom.tags.get(guild.id, name)) return respond(interaction, `A command named **${name}** already exists. Use \`/tag edit\`.`);
            try { return await interaction.showModal(textModal(sub, name, sub === 'edit' ? custom.tags.get(guild.id, name).response : '')); }
            catch (error) { if (error instanceof TextCommandUnsupported) return respond(interaction, `Add the reply after the name: \`!tag ${sub} ${name} your reply here\`.`); throw error; }
        }
        if (sub === 'create') custom.tags.create(guild.id, name, response, user.id); else custom.tags.edit(guild.id, name, response);
        return respond(interaction, `✅ Custom command **${name}** ${sub === 'create' ? 'created' : 'updated'}. Try \`/tag use name:${name}\`.`);
    } catch (error) { if (error instanceof CustomServiceError) return respond(interaction, `⚠️ ${error.message}`); throw error; }
}

// The form from /tag create and /tag edit.
async function handleCustomComponent(interaction) {
    const [, action, name] = interaction.customId.split(':');
    if (!interaction.isModalSubmit() || !['create', 'edit'].includes(action)) return;
    const say = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    if (!interaction.guild || !interaction.memberPermissions?.has(PERM)) return say('You need the **Manage Server** permission.');
    const { custom } = interaction.client.services; const text = interaction.fields.getTextInputValue('text');
    try {
        if (action === 'create') { if (isReserved(interaction.client, name)) return say('That name belongs to a built-in command.'); custom.tags.create(interaction.guild.id, name, text, interaction.user.id); } else custom.tags.edit(interaction.guild.id, name, text);
    } catch (error) { if (error instanceof CustomServiceError) return say(`⚠️ ${error.message}`); throw error; }
    return interaction.reply({ content: `✅ Custom command **${name}** ${action === 'create' ? 'created' : 'updated'}. Try \`/tag use name:${name}\`.`, allowedMentions: { parse: [] } });
}

// "!rules": called by the text-command handler when the word is not a built-in command. Returns true if it was a custom command.
async function runTextTag(message, word, rest) {
    const custom = message.client.services?.custom; if (!custom) return false;
    const tag = custom.tags.get(message.guild.id, word); if (!tag) return false;
    if (!cooldownOk('tag', message.author.id, 2500)) return true;
    custom.tags.use(message.guild.id, tag.name);
    await message.reply({ content: R.render(tag.response, ctxFor(message.guild, message.author, message.channelId, rest)), allowedMentions: NOBODY }).catch((error) => logger.warn(`Could not send a custom command: ${error.message}`));
    return true;
}

// ---------- auto-responders ----------
async function handleResponderMessage(message) {
    if (!message.guild || !message.content || message.author?.bot || message.webhookId || message.system) return;
    const { custom, textCommands } = message.client.services;
    const r = custom.responders.findMatch(message.guild.id, message.content, message.channelId); if (!r) return;
    const tc = textCommands?.getConfig?.(message.guild.id); if (tc?.enabled && message.content.startsWith(tc.prefix)) return;
    if (!custom.responders.claim(message.guild.id, r)) return;
    await message.reply({ content: R.render(r.response, ctxFor(message.guild, message.author, message.channelId)), allowedMentions: NOBODY }).catch((error) => logger.warn(`Could not send an auto-reply: ${error.message}`));
}

module.exports = { handleTagCommand, handleCustomComponent, runTextTag, handleResponderMessage, isReserved, textModal, cooldownOk, cooldowns };
