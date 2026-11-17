const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');
const { cleanText, cleanReason } = require('../../utils/text');
const { actionLogEmbed } = require('../../utils/embeds');
const {
    respond,
    ensureModerator,
    fetchTargetMember,
    guardMember,
    auditReason,
    describeError,
} = require('../../moderation/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nick')
        .setDescription("Change or reset a member's nickname.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true))
        .addStringOption((o) =>
            o.setName('nickname').setDescription('The new nickname. Leave empty to reset it.').setMaxLength(32)
        )
        .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512)),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageNicknames, 'Manage Nicknames'))) return;

        await interaction.deferReply();

        const { guild } = interaction;
        const user = interaction.options.getUser('user', true);
        const newNickname = cleanText(interaction.options.getString('nickname'), 32); // null = reset
        const reason = cleanReason(interaction.options.getString('reason'));

        try {
            const me = await guild.members.fetchMe();
            if (!me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
                return respond(interaction, 'I need the **Manage Nicknames** permission to do that.');
            }

            const member = await fetchTargetMember(guild, user.id);
            if (!member) {
                return respond(interaction, 'That user is not in this server.');
            }

            const problem = guardMember(interaction, member, me, {
                apiFlag: 'manageable',
                actionLabel: 'change the nickname of',
            });
            if (problem) return respond(interaction, problem);

            const oldNickname = member.nickname;
            interaction.client.services.suppress.mark(guild.id, 'nick', user.id);
            await member.setNickname(newNickname, auditReason(interaction, reason));

            await interaction.client.services.modLog.send(guild, {
                embeds: [
                    actionLogEmbed({
                        title: 'Nickname changed',
                        moderatorId: interaction.user.id,
                        fields: [
                            { name: 'User', value: `<@${user.id}> (\`${user.id}\`)`, inline: true },
                            { name: 'Before', value: oldNickname ?? '*(none)*', inline: true },
                            { name: 'After', value: newNickname ?? '*(reset)*', inline: true },
                            { name: 'Reason', value: reason ?? 'No reason provided' },
                        ],
                    }),
                ],
            });

            return respond(
                interaction,
                newNickname
                    ? `✅ Changed the nickname of **${user.username}** to **${newNickname}**.`
                    : `✅ Reset the nickname of **${user.username}**.`
            );
        } catch (error) {
            logger.error(`nick failed in server ${interaction.guildId}:`, error);
            return respond(interaction, `I couldn't change that nickname: ${describeError(error)}.`);
        }
    },
};
