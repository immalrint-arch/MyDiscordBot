const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { typeLabel } = require('../../utils/format');

const PERM = PermissionFlagsBits.ModerateMembers;
const EMOJI = { warn: '⚠️', note: '📝', kick: '👢', ban: '🔨', unban: '🔓', softban: '🧹', timeout: '⏳', untimeout: '✅', quarantine: '🔒', unquarantine: '🔓' };
const breakdown = (byType) => Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${EMOJI[t] ?? '•'} ${typeLabel(t)} ${n}`).join(' · ');

module.exports = {
    breakdown,
    data: new SlashCommandBuilder()
        .setName('modstats')
        .setDescription('See how many moderation actions each moderator took.')
        .setDefaultMemberPermissions(PERM)
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('Show one moderator only'))
        .addIntegerOption((o) => o.setName('days').setDescription('Look back this many days (default 30)').setMinValue(1).setMaxValue(3650)),

    async execute(interaction, { now = Date.now() } = {}) {
        if (!(await ensureModerator(interaction, PERM, 'Moderate Members'))) return;
        const days = interaction.options.getInteger('days') ?? 30;
        const who = interaction.options.getUser('user');
        const sinceIso = new Date(now - days * 864e5).toISOString();
        const rows = interaction.client.services.cases.moderatorStats(interaction.guild.id, { sinceIso, moderatorId: who?.id ?? null });
        if (!rows.length) return respond(interaction, `No moderation actions in the last ${days} day(s)${who ? ` by **${who.username}**` : ''}.`);
        const total = rows.reduce((n, r) => n + r.total, 0);
        const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(who ? `Moderation stats: ${who.username}` : 'Moderation stats')
            .setDescription(`Last **${days}** day(s) · **${total}** action(s)`)
            .setFooter({ text: 'Counts cases: warnings, notes, kicks, bans, timeouts, quarantines.' });
        for (const [i, r] of rows.slice(0, 10).entries()) embed.addFields({ name: `${who ? '' : `${i + 1}. `}${r.total} action(s)`, value: `<@${r.moderatorId}>\n${breakdown(r.byType)}`.slice(0, 1000) });
        return respond(interaction, null, { embeds: [embed] });
    },
};
