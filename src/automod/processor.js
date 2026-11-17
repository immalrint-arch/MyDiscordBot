const { EmbedBuilder, PermissionFlagsBits: P } = require('discord.js');
const { evaluate } = require('./engine');
const { createSpamTracker } = require('./detectors');
const { RULES, NOTICE, ACTION_LABEL } = require('./rules');
const { truncate } = require('../logging/textFormat');

const NOTICE_SECONDS = 6;
// People with any of these permissions are moderators themselves, so auto-moderation leaves them alone.
const STAFF_PERMISSIONS = [P.Administrator, P.ManageGuild, P.ManageMessages, P.ModerateMembers];

// The brain of auto-moderation. It never talks to the moderation commands or the case system,
// and it writes only to the "automod" log channel, so it stays separate from manual moderation.
function createAutomodProcessor({ automod, logs, suppress, logger, now = Date.now, tracker = createSpamTracker({ now }), notifySeconds = NOTICE_SECONDS }) {
    function isExempt(config, { userId, channel, member }) {
        if (config.exempt.user.includes(userId)) return true;
        if (config.exempt.channel.includes(channel.id) || (channel.parentId && config.exempt.channel.includes(channel.parentId))) return true;
        if (member.roles.cache.some((role) => config.exempt.role.includes(role.id))) return true;
        return false;
    }
    const isStaff = (member) => STAFF_PERMISSIONS.some((p) => member.permissions.has(p));

    async function log(guild, { title, color, userId, channelId, fields, content }) {
        const lines = [`### ${title}`, '', `**Member:** <@${userId}> (\`${userId}\`)`];
        if (channelId) lines.push(`**Channel:** <#${channelId}>`);
        for (const f of fields) lines.push(`**${f.name}:** ${f.value}`);
        if (content) lines.push('', `❯ ${truncate(content, 900).split('\n').join('\n❯ ')}`);
        await logs.send(guild, 'automod', {
            embeds: [new EmbedBuilder().setColor(color).setDescription(lines.join('\n').slice(0, 4000)).setTimestamp()],
            allowedMentions: { parse: [] },
        }, { channelId, userId });
    }

    async function punish(message, member, config, rule, ruleAction, detail) {
        const guild = message.guild;
        const userId = message.author.id;
        let action = ruleAction; // what we END UP doing; may be escalated below
        let strikeInfo = '';

        if (ruleAction === 'delete') {
            automod.addStrike(guild.id, userId, rule);
            const since = now() - config.strikeWindowMinutes * 60 * 1000;
            const strikes = automod.countStrikes(guild.id, userId, since);
            if (strikes >= config.strikeLimit) {
                action = 'timeout'; // too many strikes: escalate
                automod.clearStrikes(guild.id, userId);
                strikeInfo = `${strikes}/${config.strikeLimit} strikes: escalated`;
            } else {
                strikeInfo = `strike ${strikes}/${config.strikeLimit}`;
            }
        }

        let result = ACTION_LABEL[ruleAction] ?? 'Message deleted';
        if (action === 'timeout') {
            try {
                if (!member.moderatable) throw new Error('not moderatable');
                suppress.mark(guild.id, 'timeout', userId); // keeps the normal "timeout" log from repeating this
                await member.timeout(config.timeoutMinutes * 60 * 1000, `AutoMod: ${RULES[rule].label}`);
                result = `Message deleted + timed out for ${config.timeoutMinutes} min`;
            } catch {
                result = 'Message deleted (I could not time them out: check my role position and Timeout Members permission)';
            }
        } else if (action === 'kick') {
            try {
                if (!member.kickable) throw new Error('not kickable');
                suppress.mark(guild.id, 'leave', userId);
                await member.kick(`AutoMod: ${RULES[rule].label}`);
                result = 'Message deleted + kicked';
            } catch {
                result = 'Message deleted (I could not kick them: check my role position and Kick Members permission)';
            }
        }
        automod.recordEvent(guild.id, userId, message.channel.id, rule, action);
        return { result, strikeInfo };
    }

    // Called for every new (or edited) message. Returns the violation that was handled, or null.
    async function handleMessage(message) {
        try {
            if (!message.guild || !message.member || message.author.bot || message.webhookId || message.system) return null;
            const config = automod.getConfig(message.guild.id);
            if (!config.enabled) return null;
            if (message.author.id === message.guild.ownerId) return null;
            if (isStaff(message.member)) return null;
            if (isExempt(config, { userId: message.author.id, channel: message.channel, member: message.member })) return null;

            const mentionCount = new Set([...message.mentions.users.keys(), ...message.mentions.roles.keys()]).size + (message.mentions.everyone ? 1 : 0);
            const hit = evaluate({
                guildId: message.guild.id, userId: message.author.id, content: message.content ?? '', mentionCount,
                rules: config.rules, lists: config.lists, tracker,
            });
            if (!hit) return null;

            const rule = config.rules[hit.rule];
            const deleted = await message.delete().then(() => true, () => false);
            const { result, strikeInfo } = await punish(message, message.member, config, hit.rule, rule.action, hit.detail);

            // A short notice in the channel that removes itself.
            message.channel.send({
                content: `<@${message.author.id}>, ${NOTICE[hit.rule]}`,
                allowedMentions: { users: [message.author.id] },
            }).then((notice) => {
                const timer = setTimeout(() => notice.delete().catch(() => {}), notifySeconds * 1000);
                timer.unref?.();
            }).catch(() => {});

            await log(message.guild, {
                title: `🤖 AutoMod: ${RULES[hit.rule].label}`, color: 0xe67e22, userId: message.author.id, channelId: message.channel.id,
                fields: [
                    { name: 'Detected', value: hit.detail },
                    { name: 'Action', value: deleted ? result : `${result} (I could not delete the message: I may be missing Manage Messages)` },
                    ...(strikeInfo ? [{ name: 'Strikes', value: strikeInfo }] : []),
                ],
                content: hit.rule === 'words' ? null : message.content, // banned words are not repeated in logs
            });
            return hit;
        } catch (error) {
            logger.error('AutoMod failed on a message:', error);
            return null;
        }
    }

    // Suspicious accounts: a member whose account is newer than the limit.
    async function handleJoin(member) {
        try {
            if (member.user.bot) return null;
            const config = automod.getConfig(member.guild.id);
            if (!config.enabled || !config.rules.newaccount.enabled) return null;
            if (config.exempt.user.includes(member.id)) return null;
            const ageDays = (now() - member.user.createdTimestamp) / 86400000;
            if (ageDays >= config.rules.newaccount.limit) return null;

            const action = config.rules.newaccount.action;
            let result = 'Alert only';
            if (action === 'kick') {
                try {
                    suppress.mark(member.guild.id, 'leave', member.id);
                    await member.kick('AutoMod: account too new');
                    result = 'Kicked';
                } catch { result = 'Alert only (I could not kick them)'; }
            } else if (action === 'timeout') {
                try {
                    suppress.mark(member.guild.id, 'timeout', member.id);
                    await member.timeout(config.timeoutMinutes * 60 * 1000, 'AutoMod: account too new');
                    result = `Timed out for ${config.timeoutMinutes} min`;
                } catch { result = 'Alert only (I could not time them out)'; }
            }
            automod.recordEvent(member.guild.id, member.id, null, 'newaccount', action);
            await log(member.guild, {
                title: `🤖 AutoMod: ${RULES.newaccount.label}`, color: 0xe67e22, userId: member.id,
                fields: [
                    { name: 'Account age', value: `${ageDays.toFixed(1)} day(s) (minimum ${config.rules.newaccount.limit})` },
                    { name: 'Action', value: result },
                ],
            });
            return { rule: 'newaccount', result };
        } catch (error) {
            logger.error('AutoMod failed on a new member:', error);
            return null;
        }
    }

    return { handleMessage, handleJoin, tracker };
}

module.exports = { createAutomodProcessor, STAFF_PERMISSIONS };
