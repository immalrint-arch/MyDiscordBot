// Turns a channel or role into plain data we can store, so it can be recreated later.
// We store ONLY structure (names, types, permissions). Never messages or member lists.

function serializeChannel(channel) {
    const overwrites = [];
    if (channel.permissionOverwrites?.cache) {
        for (const o of channel.permissionOverwrites.cache.values()) {
            overwrites.push({ id: o.id, type: o.type, allow: String(o.allow.bitfield), deny: String(o.deny.bitfield) });
        }
    }
    return {
        name: channel.name,
        type: channel.type,
        topic: channel.topic ?? null,
        nsfw: Boolean(channel.nsfw),
        rateLimitPerUser: channel.rateLimitPerUser ?? 0,
        userLimit: channel.userLimit ?? 0,
        parentId: channel.parentId ?? null,
        position: channel.rawPosition ?? 0,
        overwrites,
    };
}

// Roles made by integrations (bot roles, boosters) cannot be recreated by us, so they return null.
function serializeRole(role) {
    if (role.managed) return null;
    return {
        name: role.name,
        color: role.color ?? 0,
        hoist: Boolean(role.hoist),
        mentionable: Boolean(role.mentionable),
        permissions: String(role.permissions.bitfield),
        position: role.position ?? 0,
    };
}

module.exports = { serializeChannel, serializeRole };
