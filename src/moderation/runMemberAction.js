const logger = require('../utils/logger');
const { cleanReason } = require('../utils/text');
const { caseEmbed, dmEmbed, appealRow, actionResultEmbed, undoResultEmbed } = require('../utils/embeds');
const { formatDuration } = require('../utils/duration');
const {
    respond,
    ensureModerator,
    fetchTargetMember,
    guardMember,
    guardOutsider,
    tryDm,
    auditReason,
    describeError,
} = require('./helpers');

// Which Discord events our own command will cause. The event loggers skip these,
// because the case card below already covers them (no double logging).
const SUPPRESS_BY_TYPE = {
    ban: ['ban', 'leave'],
    softban: ['ban', 'leave', 'unban'],
    kick: ['leave'],
    timeout: ['timeout'],
    untimeout: ['timeout'],
};

// The shared "engine" behind ban, kick, softban, timeout, untimeout, warn and note.
// Every one of them follows the same careful steps, so we write them only once:
//
//   1. check the moderator's permission
//   2. look up the target and check role hierarchy
//   3. (optionally) send the target a private message
//   4. perform the Discord action
//   5. save a case, write to the log channel, and reply
//
// `spec` describes what is different about each command (see the command files).
async function runMemberAction(interaction, spec) {
    if (!(await ensureModerator(interaction, spec.userPermission, spec.userPermissionLabel))) return;

    // Looking things up can take a moment, so tell Discord we are working on it.
    await interaction.deferReply();

    const { client, guild } = interaction;
    const { cases, guildSettings, modLog } = client.services;
    const user = interaction.options.getUser('user', true);
    const reason = spec.reason !== undefined ? spec.reason : cleanReason(interaction.options.getString('reason'));

    try {
        const me = await guild.members.fetchMe();
        if (spec.botPermission && !me.permissions.has(spec.botPermission)) {
            return respond(interaction, `I need the **${spec.botPermissionLabel}** permission to do that.`);
        }

        const member = await fetchTargetMember(guild, user.id);
        let problem = null;
        if (member) {
            problem = guardMember(interaction, member, me, {
                botMustOutrank: spec.botMustOutrank ?? true,
                apiFlag: spec.apiFlag ?? null,
                actionLabel: spec.actionLabel,
            });
            if (!problem && spec.precheck) problem = spec.precheck(member);
        } else if (spec.allowNonMember) {
            problem = guardOutsider(interaction, user, me);
        } else {
            problem = spec.notMemberMessage ?? 'That user is not in this server.';
        }
        if (problem) return respond(interaction, problem);

        const settings = guildSettings.getSettings(guild.id);
        const sendDm = settings.dmOnAction && spec.dm !== 'none' && spec.sendDm !== false;
        const dmPayload = () => ({
            embeds: [dmEmbed({
                guildName: guild.name, type: spec.type, reason,
                moderatorName: interaction.user.username, durationMs: spec.durationMs,
            })],
            // Bans get an "Appeal ban" button (the bot handles it, see moderation/appeals.js).
            components: spec.type === 'ban' ? [appealRow(guild.id)] : [],
        });

        // For kicks and bans we must message BEFORE, because afterwards we share no server.
        let dmSent = null;
        if (sendDm && spec.dm === 'before') dmSent = await tryDm(user, dmPayload());

        for (const kind of SUPPRESS_BY_TYPE[spec.type] ?? []) client.services.suppress.mark(guild.id, kind, user.id);

        if (spec.perform) {
            try {
                await spec.perform({ guild, user, member, auditReason: auditReason(interaction, reason) });
            } catch (error) {
                logger.error(`${spec.type} failed in server ${guild.id}:`, error);
                return respond(interaction, `I couldn't ${spec.actionLabel} that user: ${describeError(error)}.`);
            }
        }

        if (sendDm && spec.dm === 'after') dmSent = await tryDm(user, dmPayload());

        // The action worked, so record it. If recording fails, say so clearly.
        let record;
        try {
            record = cases.createCase({
                guildId: guild.id,
                type: spec.type,
                targetId: user.id,
                moderatorId: interaction.user.id,
                reason,
                durationMs: spec.durationMs ?? null,
                proofUrl: spec.proofUrl ?? null,
            });
            if (spec.afterRecord) spec.afterRecord(record);
        } catch (error) {
            logger.error(`Could not save a ${spec.type} case in server ${guild.id}:`, error);
            return respond(
                interaction,
                `The action succeeded, but I could not save the case record (${describeError(error)}).`
            );
        }

        await modLog.send(guild, { embeds: [caseEmbed(record, { target: user, moderator: interaction.user })] });

        // The public result message (reference images 3 and 5). It is a normal channel
        // message, not a private one, so everyone who can see the channel sees it.
        const label = `${user.username} [ \`${user.id}\` ]`;
        const extra = [];
        if (spec.durationMs) extra.push(`⏱️ **Duration:** ${formatDuration(spec.durationMs)}`);
        if (spec.proofUrl) extra.push(`📎 **Proof:** [attachment](${spec.proofUrl})`);
        extra.push(`🗂️ **Case:** #${record.caseNumber}`);

        const embed = spec.resultKind === 'undo'
            ? undoResultEmbed({
                title: spec.resultTitle, reason, moderatorId: interaction.user.id,
                successes: [`\`${user.username}\``], allDoneText: 'All users were processed!',
            })
            : actionResultEmbed({
                title: spec.resultTitle ?? `${spec.pastTense} Result:`, reason, moderatorId: interaction.user.id,
                listTitle: spec.resultListTitle ?? `${spec.pastTense}:`, entries: [{ ok: true, label }], extra,
            });

        let text = null;
        if (sendDm && dmSent === false) text = "⚠️ I couldn't send them a private message (their DMs may be closed).";
        const sent = await respond(interaction, text, { embeds: [embed] });
        if (spec.afterAction) { try { await spec.afterAction({ record, user, member, guild }); } catch (error) { logger.error(`After-action step failed for ${spec.type} in server ${guild.id}:`, error); } }
        return sent;
    } catch (error) {
        logger.error(`Unexpected error during ${spec.type} in server ${guild.id}:`, error);
        return respond(interaction, `Something went wrong: ${describeError(error)}.`);
    }
}

module.exports = { runMemberAction };
