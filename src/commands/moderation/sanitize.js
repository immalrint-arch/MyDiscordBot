const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../../utils/logger');
const { cleanReason } = require('../../utils/text');
const { actionLogEmbed } = require('../../utils/embeds');
const { planNickname } = require('../../modextras/rules');
const { respond, ensureModerator, fetchTargetMember, guardMember, auditReason, describeError } = require('../../moderation/helpers');

const PERM = PermissionFlagsBits.ManageNicknames;
const MAX_CHANGES = 100; // per run, so one command can never rename the whole server

const currentName = (m) => m.nickname ?? m.user.globalName ?? m.user.username;

async function sanitizeOne(interaction, member, me, reason) {
    const plan = planNickname(currentName(member), member.id);
    if (!plan.change) return { status: 'clean' };
    const problem = guardMember(interaction, member, me, { apiFlag: 'manageable', actionLabel: 'rename' });
    if (problem) return { status: 'blocked' };
    interaction.client.services.suppress.mark(interaction.guild.id, 'nick', member.id);
    try { await member.setNickname(plan.to, auditReason(interaction, reason)); } catch { return { status: 'blocked' }; }
    return { status: 'changed', from: currentName(member), to: plan.to };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sanitize')
        .setDescription('Clean up messy nicknames: fancy fonts, zalgo, invisible names, names that start with symbols.')
        .setDefaultMemberPermissions(PERM)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('user').setDescription('Clean one member\'s display name.')
            .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true))
            .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512)))
        .addSubcommand((s) => s.setName('all').setDescription(`Clean every messy name in the server (up to ${MAX_CHANGES} per run).`)),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Nicknames'))) return;
        await interaction.deferReply();
        const { guild } = interaction;
        const sub = interaction.options.getSubcommand();
        try {
            const me = await guild.members.fetchMe();
            if (!me.permissions.has(PERM)) return respond(interaction, 'I need the **Manage Nicknames** permission to do that.');

            if (sub === 'user') {
                const user = interaction.options.getUser('user', true);
                const member = await fetchTargetMember(guild, user.id);
                if (!member) return respond(interaction, 'That user is not in this server.');
                const reason = cleanReason(interaction.options.getString('reason')) ?? 'Nickname cleanup';
                const r = await sanitizeOne(interaction, member, me, reason);
                if (r.status === 'clean') return respond(interaction, `**${user.username}** already has a clean name.`);
                if (r.status === 'blocked') return respond(interaction, "I can't change that member's nickname (role hierarchy or permissions).");
                await interaction.client.services.modLog.send(guild, { embeds: [actionLogEmbed({ title: 'Nickname sanitized', moderatorId: interaction.user.id, fields: [
                    { name: 'User', value: `<@${user.id}> (\`${user.id}\`)`, inline: true }, { name: 'Before', value: r.from.slice(0, 100), inline: true }, { name: 'After', value: r.to, inline: true }] })] });
                return respond(interaction, `✅ Renamed **${user.username}** to **${r.to}**.`);
            }

            const members = await guild.members.fetch();
            const stats = { changed: 0, blocked: 0, clean: 0, capped: false }; const examples = [];
            for (const member of members.values()) {
                if (member.user.bot || member.id === guild.ownerId) continue;
                if (stats.changed >= MAX_CHANGES) { stats.capped = true; break; }
                const r = await sanitizeOne(interaction, member, me, 'Nickname cleanup (bulk)');
                stats[r.status]++;
                if (r.status === 'changed' && examples.length < 8) examples.push(`${r.from.slice(0, 30)} → ${r.to}`);
            }
            await interaction.client.services.modLog.send(guild, { embeds: [actionLogEmbed({ title: 'Nicknames sanitized (bulk)', moderatorId: interaction.user.id, fields: [
                { name: 'Renamed', value: String(stats.changed), inline: true }, { name: 'Could not rename', value: String(stats.blocked), inline: true }] })] });
            return respond(interaction, [`✅ Renamed **${stats.changed}** member(s). ${stats.blocked} could not be changed (higher roles or my permissions). ${stats.clean} were already clean.`,
                stats.capped ? `⚠️ Stopped at ${MAX_CHANGES} changes. Run it again to continue.` : '', examples.length ? `\n${examples.map((e) => `▸ ${e}`).join('\n')}` : ''].filter(Boolean).join('\n'));
        } catch (error) {
            logger.error(`sanitize failed in server ${guild.id}:`, error);
            return respond(interaction, `I couldn't sanitize names: ${describeError(error)}.`);
        }
    },
};
