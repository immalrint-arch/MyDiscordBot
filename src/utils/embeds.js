const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { typeLabel, unixSeconds } = require('./format');
const { formatDuration } = require('./duration');

const COLORS = {
    warn: 0xf1c40f,
    note: 0x95a5a6,
    kick: 0xe67e22,
    ban: 0xe74c3c,
    softban: 0xe74c3c,
    unban: 0x2ecc71,
    timeout: 0xe67e22,
    untimeout: 0x2ecc71,
    quarantine: 0x9b59b6,
    unquarantine: 0x2ecc71,
};
const DEFAULT_COLOR = 0x5865f2;

function shortName(user, fallbackId) {
    if (!user) return fallbackId ? `<@${fallbackId}>` : 'Unknown';
    return user.displayName ?? user.globalName ?? user.username;
}

// The "case card" shown in the log channel and by /case (your reference image 20):
// Case / Type / Moderator / Target / Reason, the target's avatar, and the date.
// `target` and `moderator` are optional Discord users. Without them we fall back to mentions.
function caseEmbed(c, { target = null, moderator = null } = {}) {
    const embed = new EmbedBuilder()
        .setColor(COLORS[c.type] ?? DEFAULT_COLOR)
        .addFields(
            { name: 'Case', value: `\`${c.caseNumber}\` ✅`, inline: true },
            { name: 'Type', value: `\`${typeLabel(c.type)}\``, inline: true },
            { name: 'Moderator', value: moderator ? `\`${shortName(moderator)}\`` : `<@${c.moderatorId}>`, inline: true },
            { name: 'Target', value: target ? `\`${shortName(target)}\`` : `<@${c.targetId}>`, inline: true },
        )
        .setTimestamp(new Date(c.createdAt));

    if (target?.displayAvatarURL) embed.setThumbnail(target.displayAvatarURL({ size: 256 }));
    if (c.durationMs) {
        embed.addFields({ name: 'Duration', value: `\`${formatDuration(c.durationMs)}\``, inline: true });
    }
    if (c.type === 'warn' && !c.active) {
        embed.addFields({ name: 'Status', value: '`Pardoned`', inline: true });
    }
    embed.addFields({ name: 'Reason', value: c.reason ?? 'No reason provided' });
    if (c.proofUrl) {
        embed.addFields({ name: 'Proof', value: `[Open attachment](${c.proofUrl})` });
        if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(c.proofUrl)) embed.setImage(c.proofUrl);
    }
    embed.setFooter({ text: `User ID: ${c.targetId}` });
    return embed;
}

const DM_HEADLINES = {
    warn: (server) => `You have been warned in ${server}!`,
    kick: (server) => `You have been kicked from ${server}!`,
    ban: (server) => `You have been banned from ${server}!`,
    softban: (server) => `You have been removed from ${server}!`,
    timeout: (server) => `You have been timed out in ${server}!`,
    quarantine: (server) => `You have been quarantined in ${server}!`,
    unquarantine: (server) => `Your quarantine in ${server} has ended!`,
};
const DM_COLOR = 0x4e5058; // quiet dark grey, like the reference

// The private message sent to the person being moderated (reference image 1):
// a bold headline, then "Reason" and "Moderator" lines.
function dmEmbed({ guildName, type, reason, moderatorName = null, durationMs = null }) {
    const headline = (DM_HEADLINES[type] ?? ((server) => `Moderation action in ${server}`))(guildName);
    const lines = [`### ${headline}`, ''];
    lines.push(`📋 **Reason:** ${reason ?? 'No reason provided'}`);
    if (moderatorName) lines.push(`👤 **Moderator:** ${moderatorName}`);
    if (durationMs) lines.push(`⏱️ **Duration:** ${formatDuration(durationMs)}`);
    if (type === 'softban') lines.push('', 'Your recent messages were removed. You are free to rejoin the server.');
    return new EmbedBuilder().setColor(DM_COLOR).setDescription(lines.join('\n').slice(0, 4000));
}

// The "Appeal ban" button under a ban message. The bot answers it (see moderation/appeals.js).
function appealRow(guildId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ap:open:${guildId}`).setLabel('Appeal ban ↗').setStyle(ButtonStyle.Secondary)
    );
}

// The public result message in the moderation channel (reference images 3 and 5).
// `entries` is a list of { ok, label, note } for each person acted on.
function actionResultEmbed({ title, reason, moderatorId, listTitle, entries, extra = [] }) {
    const lines = [`### ${title}`, '', `📋 **Reason:** ${reason ?? 'No reason provided'}`, `👤 **Moderator:** <@${moderatorId}>`, ...extra, '', `**${listTitle}**`];
    for (const e of entries) lines.push(`\u2003${e.ok ? '✅' : '❌'} ${e.label}${e.note ? ` — ${e.note}` : ''}`);
    return new EmbedBuilder().setColor(DM_COLOR).setDescription(lines.join('\n').slice(0, 4000));
}

// Result of an "undo" (unban, untimeout, unwarn): successes and failures listed separately.
function undoResultEmbed({ title, reason, moderatorId, successes, failures = [], allDoneText = 'All users were processed!' }) {
    const lines = [`### ${title}`, '', `📋 **Reason:** ${reason ?? 'No reason.'}`, `👤 **Moderator:** <@${moderatorId}>`, ''];
    lines.push('✅ **Successful**');
    lines.push(...(successes.length ? successes.map((x) => `\u2003▸ ${x}`) : ['\u2003None']));
    lines.push('', '❌ **Unsuccessful**');
    lines.push(...(failures.length ? failures.map((x) => `\u2003▸ ${x}`) : [allDoneText]));
    return new EmbedBuilder().setColor(DM_COLOR).setDescription(lines.join('\n').slice(0, 4000));
}

// A simple log entry for actions that are not cases (purge, lock, slowmode, nickname...).
function actionLogEmbed({ title, moderatorId, fields = [], color = DEFAULT_COLOR }) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .addFields({ name: 'Moderator', value: `<@${moderatorId}>`, inline: true }, ...fields)
        .setTimestamp();
}

module.exports = { caseEmbed, dmEmbed, appealRow, actionResultEmbed, undoResultEmbed, actionLogEmbed, unixSeconds };
