const { PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const { buildGreeting, varsFor } = require('./welcomeMessage');
const { renderTemplate } = require('./template');

async function send(kind, member, { force = false, channelOverride = null, fetchImpl } = {}) {
    const client = member.client;
    const { welcome } = client.services;
    const config = welcome.get(member.guild.id, kind);
    if (!force && !config.enabled) return null;
    if (!force && member.user.bot && !config.bots) return null;

    const channel = channelOverride ?? (config.channelId ? member.guild.channels.cache.get(config.channelId) : null);
    if (!channel?.isTextBased()) return null;
    const me = member.guild.members.me;
    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    if (config.style === 'card') needed.push(PermissionFlagsBits.AttachFiles);
    if (!me || !channel.permissionsFor(me)?.has(needed)) {
        logger.warn(`Cannot send the ${kind} message in server ${member.guild.id}: missing permissions in channel ${channel.id}.`);
        return null;
    }
    try {
        const payload = await buildGreeting(kind, config, member, { fetchImpl });
        const sent = await channel.send(payload);
        if (!force && config.deleteAfter > 0) {
            setTimeout(() => sent.delete().catch(() => {}), config.deleteAfter * 1000).unref?.();
        }
        return sent;
    } catch (error) {
        logger.warn(`Could not send the ${kind} message in server ${member.guild.id}: ${error.message}`);
        return null;
    }
}

const sendWelcome = (member, options) => send('welcome', member, options);
const sendGoodbye = (member, options) => send('goodbye', member, options);

// Private welcome message. Fails quietly when the member has DMs closed.
async function sendWelcomeDm(member) {
    const config = member.client.services.welcome.get(member.guild.id, 'welcome');
    if (!config.dmEnabled || member.user.bot) return false;
    try {
        await member.user.send({ content: renderTemplate(config.dmMessage, varsFor(member)).slice(0, 2000), allowedMentions: { parse: [] } });
        return true;
    } catch {
        return false;
    }
}

// Runs the whole welcome step (channel message + optional DM) for a member.
async function greetMember(member) {
    await sendWelcome(member);
    await sendWelcomeDm(member);
}

module.exports = { sendWelcome, sendGoodbye, sendWelcomeDm, greetMember };
