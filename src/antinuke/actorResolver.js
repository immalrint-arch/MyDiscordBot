const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Finds WHO did something using Discord's audit log, built for BURSTS.
//
// During a real attack there can be dozens of events per second. Asking Discord for the audit
// log once per event would hammer the API, so requests for the same server and action type
// are shared: everyone who asks within a moment gets the same answer.
//
// Audit log facts this code respects:
//   - An entry can appear a second or two AFTER the event, so we retry.
//   - The bot needs "View Audit Log", otherwise the answer is always "unknown".
//   - "Unknown" is a normal answer and callers must handle it safely.
function createActorResolver({ logger, sleep = defaultSleep, now = Date.now }) {
    const cache = new Map(); // "guild:type" -> { at, promise }
    const used = new Map(); // audit entry id -> when we stop remembering it

    function fetchEntries(guild, type, maxCacheAgeMs) {
        const key = `${guild.id}:${type}`;
        const hit = cache.get(key);
        if (hit && now() - hit.at < maxCacheAgeMs) return hit.promise;

        const promise = guild.fetchAuditLogs({ type, limit: 50 }).then((logs) => [...logs.entries.values()]);
        cache.set(key, { at: now(), promise });
        promise.catch(() => cache.delete(key));
        return promise;
    }

    // targetId: only entries about this target (null = any target)
    // consume:  each entry can answer only ONE event (used when there is no target ID, e.g. webhooks)
    async function resolve(guild, type, { targetId = null, maxAgeMs = 15000, attempts = 3, delayMs = 1200, consume = false } = {}) {
        try {
            const me = guild.members.me;
            if (me && !me.permissions.has('ViewAuditLog')) return null;

            for (let attempt = 1; attempt <= attempts; attempt++) {
                if (attempt > 1) await sleep(delayMs);
                const entries = await fetchEntries(guild, type, attempt === 1 ? 1500 : 800);

                for (const [id, expires] of used) if (expires <= now()) used.delete(id);

                const found = entries.find((entry) => {
                    const entryTarget = entry.targetId ?? entry.target?.id;
                    return (
                        (!targetId || entryTarget === targetId) &&
                        now() - entry.createdTimestamp <= maxAgeMs &&
                        !(consume && used.has(entry.id))
                    );
                });
                if (found) {
                    if (consume) used.set(found.id, now() + 60000);
                    return found;
                }
            }
            return null;
        } catch (error) {
            logger.warn(`Audit log lookup failed in server ${guild.id}: ${error.message}`);
            return null;
        }
    }

    return { resolve };
}

module.exports = { createActorResolver };
