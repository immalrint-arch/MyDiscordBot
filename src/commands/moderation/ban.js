const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runMemberAction } = require('../../moderation/runMemberAction');
const { respond, UserFacingError } = require('../../moderation/helpers');
const { parseDuration, formatDuration } = require('../../utils/duration');

const MAX_BAN_MS = 5 * 365 * 24 * 60 * 60 * 1000; // five years is plenty for a "temporary" ban
const DAY_SECONDS = 24 * 60 * 60;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban members.')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub
                .setName('add')
                .setDescription('Ban a member from your server')
                .addUserOption((o) => o.setName('user').setDescription('The user to ban').setRequired(true))
                .addStringOption((o) => o.setName('reason').setDescription('Why they are being banned').setMaxLength(512))
                .addBooleanOption((o) => o.setName('dm').setDescription('Send them a private message about the ban (default: server setting)'))
                .addStringOption((o) => o.setName('duration').setDescription('type the duration in 5s 1h 30m format (empty = permanent)').setMaxLength(20))
                .addAttachmentOption((o) => o.setName('proof').setDescription('A screenshot or image that is considered proof'))
                .addBooleanOption((o) => o.setName('hack').setDescription('Explicitly ban the user IF they are NOT in your server.'))
                .addBooleanOption((o) => o.setName('soft').setDescription('Ban and then instantly unban the member, this deletes their previous messages'))
                .addIntegerOption((o) =>
                    o.setName('purge_days').setDescription("Messages sent in the last specified days that'll be purged when banning.").setMinValue(0).setMaxValue(7)
                )
        ),

    async execute(interaction) {
        const reasonDuration = interaction.options.getString('duration');
        let durationMs = null;
        if (reasonDuration) {
            durationMs = parseDuration(reasonDuration);
            if (!durationMs || durationMs > MAX_BAN_MS) {
                return respond(interaction, 'That duration is not valid. Use something like `7d`, `12h` or `1d12h`.');
            }
        }

        const soft = interaction.options.getBoolean('soft') ?? false;
        if (soft && durationMs) return respond(interaction, 'A soft ban unbans immediately, so it cannot also have a duration.');

        const hack = interaction.options.getBoolean('hack') ?? false;
        const purgeDays = interaction.options.getInteger('purge_days') ?? (soft ? 1 : 0);

        const proof = interaction.options.getAttachment('proof');
        if (proof && !/^https:\/\//.test(proof.url)) return respond(interaction, 'That attachment could not be used as proof.');

        const { tempBans } = interaction.client.services;

        await runMemberAction(interaction, {
            type: soft ? 'softban' : 'ban',
            pastTense: soft ? 'Softbanned' : 'Banned',
            resultTitle: soft ? 'Softban Result:' : 'Ban Result:',
            resultListTitle: soft ? 'Softbanned:' : 'Banned:',
            actionLabel: soft ? 'softban' : 'ban',
            userPermission: PermissionFlagsBits.BanMembers,
            userPermissionLabel: 'Ban Members',
            botPermission: PermissionFlagsBits.BanMembers,
            botPermissionLabel: 'Ban Members',
            apiFlag: 'bannable',
            allowNonMember: hack, // banning someone who is not in the server needs "hack: True"
            notMemberMessage: 'That user is not in this server. If you really want to ban them anyway, run the command again with **hack: True**.',
            sendDm: interaction.options.getBoolean('dm') ?? undefined, // undefined = follow the server setting
            dm: 'before', // after a ban we can no longer message them
            durationMs,
            proofUrl: proof?.url ?? null,
            perform: async ({ guild, user, auditReason }) => {
                await guild.members.ban(user.id, { reason: auditReason, deleteMessageSeconds: purgeDays * DAY_SECONDS });
                if (soft) {
                    try {
                        await guild.members.unban(user.id, `Softban: ${auditReason}`.slice(0, 512));
                    } catch {
                        throw new UserFacingError('they were banned, but the automatic unban failed. Please unban them manually with /unban');
                    }
                }
            },
            // Timed bans: remember when to lift them. A new permanent ban cancels an old timer.
            afterRecord: (record) => {
                if (soft) return;
                if (durationMs) tempBans.schedule(record.guildId, record.targetId, record.caseNumber, Date.now() + durationMs);
                else tempBans.clear(record.guildId, record.targetId);
            },
        });
    },
};
