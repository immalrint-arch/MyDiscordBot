// When one of OUR commands does something (for example /ban), Discord also fires its
// own event ("a member was banned"). Without this, the same action would be logged twice:
// once as a nice case card and once as a raw event.
//
// So before a command acts, it calls mark(). The event handler then asks isSuppressed()
// and skips logging if our command already took care of it. Marks expire after 15 seconds.
function createSuppressionService({ now = Date.now, ttlMs = 15000 } = {}) {
    const marks = new Map(); // key -> time it expires

    function key(guildId, kind, id) {
        return `${guildId}:${kind}:${id}`;
    }

    function mark(guildId, kind, id) {
        const current = now();
        for (const [k, expires] of marks) if (expires <= current) marks.delete(k); // tidy up
        marks.set(key(guildId, kind, id), current + ttlMs);
    }

    function isSuppressed(guildId, kind, id) {
        const expires = marks.get(key(guildId, kind, id));
        return expires !== undefined && expires > now();
    }

    return { mark, isSuppressed };
}

module.exports = { createSuppressionService };
