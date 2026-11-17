const crypto = require('node:crypto');
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('../../utils/logger');
const { cleanReason, truncate } = require('../../utils/text');
const { actionResultEmbed, actionLogEmbed } = require('../../utils/embeds');
const { parseIdList, MAX_MASSBAN } = require('../../modextras/rules');
const { respond, ensureModerator, guardMember, guardOutsider, auditReason, describeError } = require('../../moderation/helpers');

const PERM = PermissionFlagsBits.BanMembers;
const EXPIRES_MS = 2 * 60 * 1000;
const pending = new Map(); // token -> { guildId, moderatorId, ids, reason, deleteSeconds, expires }

function sweep(now) { for (const [k, v] of pending) if (v.expires <= now) pending.delete(k); }
const buttons = (token) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mb:ok:${token}`).setLabel('Confirm ban').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`mb:no:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));

module.exports = {
    pending, // (exported for tests and for /banlist, which uses the same confirm buttons)
    buttons, sweep, EXPIRES_MS,
    data: new SlashCommandBuilder()
        .setName('massban')
        .setDescription(`Ban many people at once by pasting their IDs (up to ${MAX_MASSBAN}). You confirm first.`)
        .setDefaultMemberPermissions(PERM)
        .setDMPermission(false)
        .addStringOption((o) => o.setName('ids').setDescription('User IDs or mentions, separated by spaces, commas or new lines').setRequired(true).setMaxLength(4000))
        .addStringOption((o) => o.setName('reason').setDescription('Why they are being banned').setMaxLength(400))
        .addIntegerOption((o) => o.setName('delete_days').setDescription('Delete their messages from the last N days (0-7)').setMinValue(0).setMaxValue(7)),

    async execute(interaction, { now = Date.now() } = {}) {
        if (!(await ensureModerator(interaction, PERM, 'Ban Members'))) return;
        const parsed = parseIdList(interaction.options.getString('ids', true));
        let reason = cleanReason(interaction.options.getString('reason'));
        if (!reason && interaction.isTextCommand && parsed.leftover) reason = cleanReason(parsed.leftover); // "!massban 1 2 3 raid"
        if (!parsed.ids.length) return respond(interaction, 'I could not find any user IDs. Paste IDs (17-20 digits) or mentions.');
        if (parsed.ids.length > MAX_MASSBAN) return respond(interaction, `That is ${parsed.ids.length} IDs. The limit is ${MAX_MASSBAN} per command.`);
        await interaction.deferReply();
        try {
            const me = await interaction.guild.members.fetchMe();
            if (!me.permissions.has(PERM)) return respond(interaction, 'I need the **Ban Members** permission to do that.');
            const skip = new Set([interaction.user.id, me.id, interaction.guild.ownerId]);
            const ids = parsed.ids.filter((id) => !skip.has(id));
            if (!ids.length) return respond(interaction, 'Nothing to ban: those IDs are you, me or the server owner.');
            sweep(now);
            const token = crypto.randomBytes(5).toString('hex');
            const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
            pending.set(token, { guildId: interaction.guild.id, moderatorId: interaction.user.id, ids, reason, deleteSeconds: deleteDays * 86400, expires: now + EXPIRES_MS });
            const preview = ids.slice(0, 15).map((id) => ` ▸ \`${id}\``).join('\n') + (ids.length > 15 ? `\n …and ${ids.length - 15} more` : '');
            return respond(interaction, [
                `### ⚠️ Ban ${ids.length} user${ids.length === 1 ? '' : 's'}?`, `📋 **Reason:** ${reason ?? 'No reason provided'}`,
                deleteDays ? `🧹 Their messages from the last ${deleteDays} day(s) will be deleted.` : '', '', preview, '',
                `Only <@${interaction.user.id}> can confirm. This expires in 2 minutes.`,
            ].filter((x) => x !== '').join('\n'), { components: [buttons(token)] });
        } catch (error) {
            logger.error(`massban preview failed in server ${interaction.guildId}:`, error);
            return respond(interaction, `Something went wrong: ${describeError(error)}.`);
        }
    },

    async handleComponent(interaction, { now = Date.now() } = {}) {
        const [, action, token] = interaction.customId.split(':');
        sweep(now);
        const job = pending.get(token);
        const say = (content) => interaction.reply({ content, allowedMentions: { parse: [] } });
        if (!job || job.guildId !== interaction.guildId) return say('This massban request has expired. Run the command again.');
        if (interaction.user.id !== job.moderatorId) return say(`Only <@${job.moderatorId}> can use these buttons.`);
        pending.delete(token); // from here on it can run only once, even if the button is double-clicked
        if (action === 'no') return interaction.update({ content: '❌ Massban cancelled.', components: [] });
        if (!interaction.memberPermissions?.has(PERM)) return interaction.update({ content: 'You no longer have the **Ban Members** permission.', components: [] });

        await interaction.update({ content: `⏳ Banning ${job.ids.length} user(s)…`, components: [] });
        const { guild } = interaction;
        const { cases, suppress } = interaction.client.services;
        const entries = []; const caseNumbers = [];
        try {
            const me = await guild.members.fetchMe();
            const why = job.reason ?? 'No reason provided';
            for (const id of job.ids) {
                try {
                    const member = await guild.members.fetch(id).catch(() => null);
                    const problem = member
                        ? guardMember(interaction, member, me, { apiFlag: 'bannable', actionLabel: 'ban' })
                        : guardOutsider(interaction, { id }, me);
                    if (problem) { entries.push({ ok: false, label: `\`${id}\``, note: truncate(problem, 70) }); continue; }
                    suppress.mark(guild.id, 'ban', id); suppress.mark(guild.id, 'leave', id);
                    await guild.members.ban(id, { reason: auditReason(interaction, `Massban: ${why}`), deleteMessageSeconds: job.deleteSeconds });
                    const record = cases.createCase({ guildId: guild.id, type: 'ban', targetId: id, moderatorId: interaction.user.id, reason: truncate(`Massban: ${why}`, 512) });
                    caseNumbers.push(record.caseNumber);
                    entries.push({ ok: true, label: `\`${id}\``, note: `case #${record.caseNumber}` });
                } catch (error) {
                    entries.push({ ok: false, label: `\`${id}\``, note: truncate(describeError(error), 70) });
                }
            }
            const okCount = entries.filter((e) => e.ok).length;
            const shown = [...entries.filter((e) => !e.ok), ...entries.filter((e) => e.ok)].slice(0, 20);
            await interaction.client.services.modLog.send(guild, { embeds: [actionLogEmbed({ title: 'Massban', moderatorId: interaction.user.id, fields: [
                { name: 'Banned', value: `${okCount} of ${job.ids.length}`, inline: true },
                { name: 'Cases', value: caseNumbers.length ? `#${Math.min(...caseNumbers)} – #${Math.max(...caseNumbers)}` : 'none', inline: true },
                { name: 'Reason', value: truncate(why, 500) }] })] });
            return interaction.editReply({ content: null, allowedMentions: { parse: [] }, components: [], embeds: [actionResultEmbed({
                title: 'Massban Result:', reason: job.reason, moderatorId: interaction.user.id, listTitle: 'Bans:',
                entries: shown, extra: [`✅ **Banned:** ${okCount} of ${job.ids.length}`, entries.length > shown.length ? `Showing ${shown.length} of ${entries.length}, failures first.` : ''].filter(Boolean) })] });
        } catch (error) {
            logger.error(`massban failed in server ${guild.id}:`, error);
            return interaction.editReply({ content: `Massban stopped early: ${describeError(error)}. ${entries.filter((e) => e.ok).length} were banned before it stopped.`, components: [], allowedMentions: { parse: [] } });
        }
    },
};
