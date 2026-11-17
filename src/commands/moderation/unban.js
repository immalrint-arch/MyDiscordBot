const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../../utils/logger');
const { isSnowflake } = require('../../utils/snowflake');
const { cleanReason } = require('../../utils/text');
const { caseEmbed, undoResultEmbed } = require('../../utils/embeds');
const { respond, ensureModerator, auditReason, describeError } = require('../../moderation/helpers');

const MAX_USERS = 10;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban one or more users using their Discord IDs.')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .setDMPermission(false)
        .addStringOption((o) =>
            o.setName('user_id').setDescription(`ID of the banned user (up to ${MAX_USERS}, separated by spaces or commas)`).setRequired(true).setMaxLength(250)
        )
        .addStringOption((o) => o.setName('reason').setDescription('Why they are being unbanned').setMaxLength(512)),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.BanMembers, 'Ban Members'))) return;

        const ids = [...new Set(interaction.options.getString('user_id', true).split(/[\s,]+/).filter(Boolean))];
        if (ids.length === 0 || ids.length > MAX_USERS) return respond(interaction, `Give between 1 and ${MAX_USERS} user IDs.`);
        const badId = ids.find((id) => !isSnowflake(id));
        if (badId) return respond(interaction, `\`${badId.slice(0, 25)}\` does not look like a Discord user ID. It should be 17-20 digits.`);

        await interaction.deferReply();

        const { client, guild } = interaction;
        const { cases, modLog, tempBans } = client.services;
        const reason = cleanReason(interaction.options.getString('reason'));

        try {
            const me = await guild.members.fetchMe();
            if (!me.permissions.has(PermissionFlagsBits.BanMembers)) {
                return respond(interaction, 'I need the **Ban Members** permission to do that.');
            }

            const successes = [];
            const failures = [];
            for (const userId of ids) {
                const user = await client.users.fetch(userId).catch(() => null);
                const name = user ? user.username : userId;
                try {
                    await guild.bans.fetch(userId); // throws "Unknown Ban" when they are not banned
                } catch (error) {
                    failures.push(`\`${name}\` — ${error.code === 10026 ? 'is not banned' : describeError(error)}`);
                    continue;
                }
                try {
                    client.services.suppress.mark(guild.id, 'unban', userId);
                    await guild.members.unban(userId, auditReason(interaction, reason));
                    tempBans.clear(guild.id, userId); // a manual unban cancels any timer
                    const record = cases.createCase({ guildId: guild.id, type: 'unban', targetId: userId, moderatorId: interaction.user.id, reason });
                    await modLog.send(guild, { embeds: [caseEmbed(record, { target: user, moderator: interaction.user })] });
                    successes.push(`\`${name}\``);
                } catch (error) {
                    logger.error(`unban failed in server ${guild.id}:`, error);
                    failures.push(`\`${name}\` — ${describeError(error)}`);
                }
            }

            const embed = undoResultEmbed({
                title: 'Unban result:', reason: reason ?? 'No reason.', moderatorId: interaction.user.id,
                successes, failures, allDoneText: 'All users were unbanned!',
            });
            return respond(interaction, null, { embeds: [embed] });
        } catch (error) {
            logger.error(`Unexpected error during unban in server ${guild.id}:`, error);
            return respond(interaction, `Something went wrong: ${describeError(error)}.`);
        }
    },
};
