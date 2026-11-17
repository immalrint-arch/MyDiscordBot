const { Events, AuditLogEvent } = require('discord.js');
const { COLORS, logEmbed, footerForUser, profileButton, actorText } = require('../logging/style');
const { line, dateWithAgo, stamp, diffLists } = require('../logging/textFormat');

// One Discord event covers many changes. We check each kind and log the ones that happened:
//   - accepted the rules (reference image 3)
//   - roles added/removed (reference image 2)
//   - nickname changed
//   - timeout started/removed (reference image 15)
module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        // If we never saw the "before" version we cannot tell what changed.
        if (oldMember.partial) return;

        const { logs, audit, suppress } = newMember.client.services;
        const { guild, user } = newMember;
        const send = (embed) =>
            logs.send(
                guild,
                'members',
                { embeds: [embed], components: [profileButton(user.id)] },
                { userId: user.id, roleIds: [...newMember.roles.cache.keys()] }
            );
        const base = { footer: footerForUser(user, new Date()), thumbnailUrl: user.displayAvatarURL({ size: 256 }) };

        // 1. Rules accepted (membership screening)
        if (oldMember.pending === true && newMember.pending === false) {
            await send(
                logEmbed({
                    ...base,
                    color: COLORS.green,
                    title: 'Rules Accepted',
                    headline: `<@${user.id}> passed membership screening and accepted the server rules.`,
                    lines: [line('Account created', dateWithAgo(user.createdTimestamp))],
                })
            );
        }

        // 2. Roles
        const { added, removed } = diffLists([...oldMember.roles.cache.keys()], [...newMember.roles.cache.keys()]);
        if (added.length || removed.length) {
            const entry = await audit.findEntry(guild, AuditLogEvent.MemberRoleUpdate, { targetId: user.id });
            const lines = [line('Updated by', actorText(entry))];
            if (added.length) lines.push('', '**Roles Added**', added.map((id) => `<@&${id}>`).join(' '));
            if (removed.length) lines.push('', '**Roles Removed**', removed.map((id) => `<@&${id}>`).join(' '));
            await send(
                logEmbed({
                    ...base,
                    color: COLORS.blue,
                    title: 'Member Roles Updated',
                    headline: `Roles were updated for <@${user.id}>.`,
                    lines,
                })
            );
        }

        // 3. Nickname
        if (oldMember.nickname !== newMember.nickname && !suppress.isSuppressed(guild.id, 'nick', user.id)) {
            await send(
                logEmbed({
                    ...base,
                    color: COLORS.blue,
                    title: 'Nickname Changed',
                    headline: `The nickname of <@${user.id}> was changed.`,
                    lines: [
                        line('Before', oldMember.nickname ?? '*(none)*'),
                        line('After', newMember.nickname ?? '*(none)*'),
                    ],
                })
            );
        }

        // 4. Timeout
        const before = oldMember.communicationDisabledUntilTimestamp;
        const after = newMember.communicationDisabledUntilTimestamp;
        const timedOutNow = after && after > Date.now();
        const wasTimedOut = before && before > Date.now();
        if (before !== after && !suppress.isSuppressed(guild.id, 'timeout', user.id)) {
            const entry = await audit.findEntry(guild, AuditLogEvent.MemberUpdate, { targetId: user.id });
            if (timedOutNow) {
                await send(
                    logEmbed({
                        ...base,
                        color: COLORS.yellow,
                        title: 'Member Timed Out',
                        headline: `<@${user.id}> was placed in timeout.`,
                        lines: [
                            line('Timeout expires', `${stamp(after, 'f')} (${stamp(after, 'R')})`),
                            line('Timed out by', actorText(entry)),
                            line('Reason', entry?.reason ?? 'No reason provided'),
                        ],
                    })
                );
            } else if (wasTimedOut) {
                await send(
                    logEmbed({
                        ...base,
                        color: COLORS.green,
                        title: 'Timeout Removed',
                        headline: `The timeout of <@${user.id}> was removed.`,
                        lines: [line('Removed by', actorText(entry))],
                    })
                );
            }
        }
    },
};
