const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Looks up WHO did something, using Discord's audit log.
//
// Important facts about audit logs (and why this code is careful):
//  - An audit log entry can appear a second or two AFTER the event itself, so we retry a few times.
//  - The bot needs the "View Audit Log" permission, otherwise we simply cannot know who did it.
//  - Entries do not always exist for every action, so "unknown" is a normal, valid answer.
//  - We only accept entries about the right target and created in the last few seconds,
//    so we never blame someone for an older, unrelated action.
function createAuditService({ logger, sleep = defaultSleep, now = Date.now }) {
    async function findEntry(guild, type, { targetId, maxAgeMs = 10000, attempts = 3, delayMs = 1200 } = {}) {
        try {
            const me = guild.members.me;
            if (me && !me.permissions.has('ViewAuditLog')) return null;

            for (let attempt = 1; attempt <= attempts; attempt++) {
                if (attempt > 1) await sleep(delayMs);

                const logs = await guild.fetchAuditLogs({ type, limit: 8 });
                const found = [...logs.entries.values()].find((entry) => {
                    const entryTarget = entry.targetId ?? entry.target?.id;
                    return (!targetId || entryTarget === targetId) && now() - entry.createdTimestamp <= maxAgeMs;
                });
                if (found) return found;
            }
            return null;
        } catch (error) {
            logger.warn(`Audit log lookup failed in server ${guild.id}: ${error.message}`);
            return null;
        }
    }

    return { findEntry };
}

module.exports = { createAuditService };
