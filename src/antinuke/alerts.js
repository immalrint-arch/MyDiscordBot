const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { RULES } = require('./rules');
const { stamp, truncate } = require('../logging/textFormat');

const COLORS = { low: 0xf1c40f, medium: 0xe67e22, high: 0xe74c3c };
const CLASS_TEXT = {
    owner: 'server owner',
    trusted: 'trusted',
    bot: 'bot (not trusted)',
    member: 'member',
    unknown: 'unknown (audit log could not say)',
};

function statusText(incident, containNote) {
    if (incident.simulated) return '🧪 **Simulation**: nothing real was changed.';
    switch (incident.status) {
        case 'contained':
            return `🔒 **Contained**: dangerous roles removed from the account${containNote ? `\n${containNote}` : ''}`;
        case 'restored':
            return '↩️ **Restored**: the removed roles were given back.';
        case 'safe':
            return '✅ **Marked safe** by the owner (false positive).';
        default:
            return `👀 **Alert only**: no action was taken. Use the buttons below.${containNote ? `\n${containNote}` : ''}`;
    }
}

// The alert message with its Contain / Restore / Mark safe / Recover buttons.
function alertPayload(incident, { hasRecoverable = false, containNote = null } = {}) {
    const ruleLines = incident.rules.map((r) => {
        const label = RULES[r.rule]?.label ?? r.rule;
        return RULES[r.rule]?.single
            ? `• ${label}`
            : `• ${label}: **${r.count}** within ${r.windowSec}s (limit ${r.threshold})`;
    });
    const recent = incident.evidence
        .slice(-5)
        .map((e) => `• ${RULES[e.rule]?.label ?? e.rule}: ${truncate(e.target ?? 'unknown', 60)} (${stamp(e.at, 'T')})`);

    const who = incident.actorId ? `<@${incident.actorId}> · ${CLASS_TEXT[incident.actorClass] ?? incident.actorClass}` : CLASS_TEXT.unknown;
    const lines = [
        `**Actor:** ${who}`,
        `**Severity:** ${incident.severity.toUpperCase()}`,
        `**Status:** ${statusText(incident, containNote)}`,
        '',
        '**What triggered this**',
        ...ruleLines,
        '',
        '**Most recent actions**',
        ...recent,
        '',
        '-# If this is a normal bot or a planned change, use /antinuke trust-add so it does not alert again.',
    ];

    const embed = new EmbedBuilder()
        .setColor(COLORS[incident.severity] ?? COLORS.medium)
        .setTitle(`🛡️ Anti-Nuke Alert · Incident #${incident.number}${incident.simulated ? ' (simulation)' : ''}`)
        .setDescription(truncate(lines.join('\n'), 4000))
        .setTimestamp();

    const canAct = Boolean(incident.actorId) || incident.simulated;
    const buttons = [
        new ButtonBuilder()
            .setCustomId(`an:contain:${incident.number}`)
            .setLabel('Contain')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!canAct || ['contained', 'safe'].includes(incident.status)),
        new ButtonBuilder()
            .setCustomId(`an:restore:${incident.number}`)
            .setLabel('Restore')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(incident.status !== 'contained'),
        new ButtonBuilder()
            .setCustomId(`an:safe:${incident.number}`)
            .setLabel('Mark safe (owner)')
            .setStyle(ButtonStyle.Success)
            .setDisabled(incident.status === 'safe'),
    ];
    if (hasRecoverable && !incident.simulated) {
        buttons.push(
            new ButtonBuilder().setCustomId(`an:recover:${incident.number}`).setLabel('Recover deleted').setStyle(ButtonStyle.Primary)
        );
    }
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)] };
}

module.exports = { alertPayload, COLORS };
