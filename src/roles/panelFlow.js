const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const logger = require('../utils/logger');
const { describeError } = require('../moderation/helpers');
const { roleProblem, planRoleChange, parseEmoji, reactionKey } = require('./roleRules');

const NO_PINGS = { parse: [] };
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: NO_PINGS });

// Turns the emoji text we stored into what discord.js components accept.
function componentEmoji(stored) {
    const parsed = parseEmoji(stored ?? '');
    if (!parsed) return undefined;
    if (!parsed.custom) return parsed.display;
    const m = parsed.display.match(/^<(a?):(\w+):(\d+)>$/);
    return { id: m[3], name: m[2], animated: m[1] === 'a' };
}

// Builds the message people click on. `options` come from roleService.options(panel.id).
function buildPanelPayload(panel, options) {
    const lines = options.map((o) => `${o.emoji ? `${o.emoji} ` : ''}<@&${o.roleId}>${o.description ? ` — ${o.description}` : ''}`);
    const hints = [];
    if (panel.maxRoles === 1) hints.push('Pick **one**.');
    else if (panel.maxRoles > 1) hints.push(`Pick up to **${panel.maxRoles}**.`);
    if (!panel.allowRemove) hints.push('Choices are final.');
    if (panel.requiredRoleId) hints.push(`Needs <@&${panel.requiredRoleId}>.`);
    const embed = new EmbedBuilder()
        .setColor(panel.color)
        .setTitle(panel.title)
        .setDescription([panel.description, lines.join('\n') || '*No roles yet.*', hints.length ? `*${hints.join(' ')}*` : '']
            .filter(Boolean).join('\n\n'));

    const components = [];
    if (panel.mode === 'button') {
        for (let i = 0; i < options.length; i += 5) {
            components.push(new ActionRowBuilder().addComponents(
                options.slice(i, i + 5).map((o) => {
                    const button = new ButtonBuilder().setCustomId(`rp:t:${panel.id}:${o.roleId}`).setLabel(o.label.slice(0, 80)).setStyle(ButtonStyle.Secondary);
                    const emoji = componentEmoji(o.emoji);
                    if (emoji) button.setEmoji(emoji);
                    return button;
                })
            ));
        }
    } else if (panel.mode === 'dropdown' && options.length) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`rp:m:${panel.id}`)
            .setPlaceholder('Choose your roles…')
            .setMinValues(0)
            .setMaxValues(panel.maxRoles > 0 ? Math.min(panel.maxRoles, options.length) : options.length)
            .addOptions(options.map((o) => {
                const entry = { label: o.label.slice(0, 100), value: o.roleId };
                if (o.description) entry.description = o.description.slice(0, 100);
                const emoji = componentEmoji(o.emoji);
                if (emoji) entry.emoji = emoji;
                return entry;
            }));
        components.push(new ActionRowBuilder().addComponents(menu));
    }
    return { embeds: [embed], components, allowedMentions: NO_PINGS };
}

// Posts the panel, or updates it if it was already posted. Returns the message.
async function publishPanel(guild, panel, channel, { roles }) {
    const options = roles.options(panel.id);
    if (!options.length) throw new Error('Add at least one role to the panel first.');
    const me = guild.members.me ?? await guild.members.fetchMe();
    const perms = channel.permissionsFor(me);
    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    if (panel.mode === 'reaction') needed.push(PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory);
    if (!perms?.has(needed)) throw new Error(`I need View Channel, Send Messages, Embed Links${panel.mode === 'reaction' ? ', Add Reactions and Read Message History' : ''} in <#${channel.id}>.`);

    const payload = buildPanelPayload(panel, options);
    let message = null;
    if (panel.messageId && panel.channelId === channel.id) {
        message = await channel.messages.fetch(panel.messageId).catch(() => null);
        if (message) message = await message.edit(payload);
    }
    if (!message) {
        // moved to another channel, or the old message is gone
        if (panel.messageId && panel.channelId) {
            const oldChannel = guild.channels.cache.get(panel.channelId);
            await oldChannel?.messages?.delete?.(panel.messageId).catch(() => {});
        }
        message = await channel.send(payload);
    }
    roles.setPublished(panel.id, channel.id, message.id);
    if (panel.mode === 'reaction') {
        for (const option of options) {
            const emoji = parseEmoji(option.emoji ?? '');
            if (!emoji) continue;
            await message.react(emoji.custom ? emoji.key : emoji.display).catch((error) => logger.warn(`Could not add reaction ${option.emoji}: ${error.message}`));
        }
    }
    return message;
}

// Re-draws an already posted panel after its roles/settings changed. Never throws.
async function refreshPanel(guild, panel, services) {
    if (!panel.messageId || !panel.channelId) return;
    try {
        const channel = guild.channels.cache.get(panel.channelId) ?? await guild.channels.fetch(panel.channelId);
        const fresh = services.roles.getPanelById(panel.id);
        if (channel && services.roles.options(panel.id).length) await publishPanel(guild, fresh, channel, services);
    } catch (error) {
        logger.warn(`Could not refresh role panel ${panel.id}: ${error.message}`);
    }
}

// Gives/removes roles for one member. Returns lines of text describing what happened.
async function applyPlan({ guild, member, plan, panel, me }) {
    const notes = [];
    const toAdd = [];
    for (const id of plan.add) {
        const role = guild.roles.cache.get(id);
        const problem = roleProblem({ role, guildId: guild.id, botHighestPosition: me.roles.highest.position, forbidDangerous: true });
        if (problem) notes.push(`⚠️ I cannot give <@&${id}>: ${problem}`);
        else toAdd.push(id);
    }
    const toRemove = plan.remove.filter((id) => guild.roles.cache.has(id));
    try {
        if (toRemove.length) await member.roles.remove(toRemove, `Role panel: ${panel.name}`);
        if (toAdd.length) await member.roles.add(toAdd, `Role panel: ${panel.name}`);
    } catch (error) {
        logger.warn(`Role panel change failed in server ${guild.id}: ${error.message}`);
        return { ok: false, notes: [`I could not change your roles: ${describeError(error)}. Please tell a moderator.`], added: [], removed: [] };
    }
    return { ok: true, notes, added: toAdd, removed: toRemove };
}

const describeResult = ({ added, removed, notes }) => [
    added.length ? `✅ Added ${added.map((id) => `<@&${id}>`).join(' ')}` : null,
    removed.length ? `➖ Removed ${removed.map((id) => `<@&${id}>`).join(' ')}` : null,
    !added.length && !removed.length && !notes.length ? 'Nothing changed.' : null,
    ...notes,
].filter(Boolean).join('\n');

// Buttons and dropdowns. customId: rp:t:<panelId>:<roleId>  or  rp:m:<panelId>
async function handlePanelComponent(interaction) {
    const [, kind, panelIdText, roleId] = interaction.customId.split(':');
    const { roles } = interaction.client.services;
    if (!interaction.inGuild()) return;
    const panel = roles.getPanelById(Number(panelIdText));
    if (!panel || panel.guildId !== interaction.guildId) return interaction.reply(ephemeral('This role panel no longer exists.'));

    const guild = interaction.guild;
    const member = interaction.member?.roles?.cache ? interaction.member : await guild.members.fetch(interaction.user.id);
    if (panel.requiredRoleId && !member.roles.cache.has(panel.requiredRoleId)) {
        return interaction.reply(ephemeral(`You need the <@&${panel.requiredRoleId}> role to use this panel.`));
    }
    const options = roles.options(panel.id);
    const panelRoles = options.map((o) => o.roleId);
    const held = panelRoles.filter((id) => member.roles.cache.has(id));
    const action = kind === 'm' ? { type: 'select', roleIds: interaction.values ?? [] } : { type: 'toggle', roleId };

    const plan = planRoleChange({ held, panelRoles, action, maxRoles: panel.maxRoles, allowRemove: panel.allowRemove });
    if (plan.error) return interaction.reply(ephemeral(`⚠️ ${plan.error}`));
    const me = guild.members.me ?? await guild.members.fetchMe();
    const result = await applyPlan({ guild, member, plan, panel, me });
    return interaction.reply(ephemeral(describeResult(result)));
}

// Reaction roles. `added` is true for messageReactionAdd and false for messageReactionRemove.
async function handleReaction(reaction, user, added, client) {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    const message = reaction.message;
    if (!message.guildId) return;
    const { roles } = client.services;
    const panel = roles.findPanelByMessage(message.id);
    if (!panel || panel.mode !== 'reaction' || panel.guildId !== message.guildId) return;

    const options = roles.options(panel.id);
    const key = reactionKey(reaction.emoji);
    const option = options.find((o) => parseEmoji(o.emoji ?? '')?.key === key);
    const guild = client.guilds.cache.get(message.guildId);
    if (!guild) return;
    if (!option) { // not one of the panel's emoji: tidy it up
        if (added) await reaction.users.remove(user.id).catch(() => {});
        return;
    }
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;
    if (panel.requiredRoleId && !member.roles.cache.has(panel.requiredRoleId)) {
        if (added) await reaction.users.remove(user.id).catch(() => {});
        return;
    }
    const panelRoles = options.map((o) => o.roleId);
    const held = panelRoles.filter((id) => member.roles.cache.has(id));
    const plan = planRoleChange({ held, panelRoles, action: { type: added ? 'add' : 'remove', roleId: option.roleId }, maxRoles: panel.maxRoles, allowRemove: panel.allowRemove });

    const undoReaction = () => reaction.users.remove(user.id).catch(() => {});
    if (plan.error) { if (added) await undoReaction(); return; }
    if (!added && !panel.allowRemove) return; // role stays
    const me = guild.members.me ?? await guild.members.fetchMe();
    const result = await applyPlan({ guild, member, plan, panel, me });
    if (added && (!result.ok || (plan.add.length && !result.added.length))) await undoReaction();

    // swapping: take the person's other reactions off the message
    if (added && result.ok && result.removed.length) {
        for (const other of options.filter((o) => result.removed.includes(o.roleId))) {
            const otherKey = parseEmoji(other.emoji ?? '')?.key;
            const react = message.reactions.cache.find((r) => reactionKey(r.emoji) === otherKey);
            await react?.users.remove(user.id).catch(() => {});
        }
    }
}

module.exports = { buildPanelPayload, publishPanel, refreshPanel, handlePanelComponent, handleReaction, componentEmoji };
