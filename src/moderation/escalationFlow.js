// Warn escalation: runs after a warning is saved, and /warnescalation.
const { PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const R = require('./escalation');
const { caseEmbed, dmEmbed } = require('../utils/embeds');
const { respond, ensureModerator, tryDm, describeError } = require('./helpers');
const { EscalationServiceError } = require('../services/escalationService');

const NOBODY = { parse: [] };
const PERM = PermissionFlagsBits.ManageGuild;

// Called by /warn after the warning is recorded. Does nothing unless the server turned escalation on and a rule matches the new count.
async function runEscalation(interaction, { record, user, member }, { now = Date.now() } = {}) {
    const { client, guild } = interaction; const { escalation, cases, modLog, suppress, guildSettings } = client.services;
    if (!escalation) return null;
    const config = escalation.getConfig(guild.id); if (!config.enabled) return null;
    const count = cases.countActiveWarnings(guild.id, user.id, R.sinceIso(config.windowDays, now));
    const rule = R.pickRule(escalation.list(guild.id), count); if (!rule) return null;
    const say = (content) => interaction.channel?.send?.({ content, allowedMentions: NOBODY }).catch(() => {});
    const why = `Automatic: reached ${count} warning${count === 1 ? '' : 's'} (warn case #${record.caseNumber})`;
    if (!member) { await say(`⚠️ <@${user.id}> reached ${count} warnings (${R.describeRule(rule)}), but they are not in the server, so nothing was done.`); return { skipped: 'not in server' }; }
    const me = await guild.members.fetchMe();
    const can = { timeout: member.moderatable && me.permissions.has(PermissionFlagsBits.ModerateMembers), kick: member.kickable && me.permissions.has(PermissionFlagsBits.KickMembers), ban: member.bannable && me.permissions.has(PermissionFlagsBits.BanMembers) }[rule.action];
    if (!can || member.id === guild.ownerId) { await say(`⚠️ <@${user.id}> reached ${count} warnings (${R.describeRule(rule)}), but I cannot ${rule.action} them (my role or permissions are too low). A moderator needs to act.`); return { skipped: 'cannot' }; }
    const durationMs = rule.action === 'timeout' ? rule.durationMinutes * 60000 : null;
    const sendDm = guildSettings.getSettings(guild.id).dmOnAction;
    const dm = () => tryDm(user, { embeds: [dmEmbed({ guildName: guild.name, type: rule.action, reason: why, moderatorName: client.user.username, durationMs })] });
    try {
        if (sendDm && rule.action !== 'timeout') await dm();
        if (rule.action === 'timeout') { suppress.mark(guild.id, 'timeout', user.id); await member.timeout(durationMs, why.slice(0, 500)); if (sendDm) await dm(); }
        else if (rule.action === 'kick') { suppress.mark(guild.id, 'leave', user.id); await member.kick(why.slice(0, 500)); }
        else { suppress.mark(guild.id, 'ban', user.id); suppress.mark(guild.id, 'leave', user.id); await guild.members.ban(user.id, { reason: why.slice(0, 500) }); }
    } catch (error) { logger.warn(`Warn escalation failed in ${guild.id}: ${error.message}`); await say(`⚠️ <@${user.id}> reached ${count} warnings but I could not ${rule.action} them: ${describeError(error)}.`); return { skipped: 'failed' }; }
    const action = cases.createCase({ guildId: guild.id, type: rule.action, targetId: user.id, moderatorId: client.user.id, reason: why, durationMs });
    await modLog.send(guild, { embeds: [caseEmbed(action, { target: user, moderator: client.user })] });
    await say(`🚨 <@${user.id}> reached **${count} warning${count === 1 ? '' : 's'}**: ${rule.action === 'timeout' ? `timed out for ${R.minutesText(rule.durationMinutes)}` : rule.action === 'kick' ? 'kicked' : 'banned'} automatically. 🗂️ Case #${action.caseNumber}`);
    return { applied: rule.action, caseNumber: action.caseNumber };
}

async function handleWarnEscalationCommand(interaction) {
    if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
    const { escalation } = interaction.client.services; const o = interaction.options; const g = interaction.guildId; const sub = o.getSubcommand();
    try {
        if (sub === 'add') { const rule = escalation.setRule(g, { threshold: o.getInteger('warnings', true), action: o.getString('action', true), durationMinutes: o.getInteger('minutes') }); const on = escalation.getConfig(g).enabled; return respond(interaction, `✅ Rule saved: **${R.describeRule(rule)}**.${on ? '' : ' Escalation is still **off**: turn it on with `/warnescalation toggle enabled:true`.'}`); }
        if (sub === 'remove') { const n = o.getInteger('warnings', true); return respond(interaction, escalation.removeRule(g, n) ? `🗑️ Removed the rule for ${n} warning${n === 1 ? '' : 's'}.` : `There is no rule for ${n} warning${n === 1 ? '' : 's'}.`); }
        if (sub === 'toggle') { const on = o.getBoolean('enabled', true); escalation.setEnabled(g, on); return respond(interaction, `✅ Warn escalation is **${on ? 'on' : 'off'}**.${on && !escalation.list(g).length ? ' (You have no rules yet. Add one with `/warnescalation add`.)' : ''}`); }
        if (sub === 'window') { const d = o.getInteger('days', true); escalation.setWindow(g, d); return respond(interaction, d ? `✅ Only warnings from the last **${d} days** count.` : '✅ Every active warning counts, however old.'); }
        const c = escalation.getConfig(g); const rules = escalation.list(g);
        return respond(interaction, [`**Warn escalation:** ${c.enabled ? 'on ✅' : 'off ⛔'} · ${c.windowDays ? `counts warnings from the last ${c.windowDays} days` : 'counts every active warning'}`, ...(rules.length ? rules.map((r) => `▸ ${R.describeRule(r)}`) : ['No rules yet. Example: `/warnescalation add warnings:3 action:timeout minutes:60`'])].join('\n'));
    } catch (error) { if (error instanceof EscalationServiceError) return respond(interaction, `⚠️ ${error.message}`); throw error; }
}

module.exports = { runEscalation, handleWarnEscalationCommand };
