// Turns a server's structure (roles, channels, permissions) into plain data, and back into a plan.
// No Discord calls here: everything works on simple objects so it can be tested.
const SUPPORTED = new Set([0, 2, 4, 5, 13, 15]); // text, voice, category, announcement, stage, forum
const TYPE_NAMES = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announcement', 13: 'stage', 15: 'forum' };
const MAX_BYTES = 900 * 1024, MAX_ROLES = 250, MAX_CHANNELS = 500;
const GUILD_KEYS = ['name', 'verificationLevel', 'defaultMessageNotifications', 'explicitContentFilter', 'afkTimeout'];

const bits = (v) => (v == null ? '0' : String(typeof v === 'bigint' ? v : (v.bitfield ?? v)));

function overwritesOf(channel, guildId, keyOf) {
    const out = [];
    for (const o of channel.permissionOverwrites?.cache?.values?.() ?? []) {
        const ref = o.id === guildId ? { kind: 'everyone' } : keyOf.has(o.id) ? { kind: 'role', key: keyOf.get(o.id) } : o.type === 1 ? { kind: 'member', id: o.id } : null;
        if (ref) out.push({ ...ref, allow: bits(o.allow), deny: bits(o.deny) });
    }
    return out;
}

// guild: a discord.js Guild (or anything shaped like one)
function buildSnapshot(guild) {
    const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id && !r.managed).sort((a, b) => a.position - b.position)
        .map((r, i) => ({ key: `r${i}`, id: r.id, name: String(r.name).slice(0, 100), color: r.color ?? 0, hoist: Boolean(r.hoist), mentionable: Boolean(r.mentionable), permissions: bits(r.permissions), position: r.position }));
    const keyOf = new Map(roles.map((r) => [r.id, r.key])); const everyone = guild.roles.cache.get(guild.id);
    const all = [...guild.channels.cache.values()].filter((c) => SUPPORTED.has(c.type));
    const nameOf = (id) => all.find((c) => c.id === id)?.name ?? null;
    const channels = all.sort((a, b) => (a.type === 4 ? -1 : 0) - (b.type === 4 ? -1 : 0) || (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0)).map((c) => ({
        name: String(c.name).slice(0, 100), type: c.type, topic: c.topic ? String(c.topic).slice(0, 1024) : null, nsfw: Boolean(c.nsfw), slowmode: c.rateLimitPerUser ?? 0,
        bitrate: c.bitrate ?? null, userLimit: c.userLimit ?? null, parent: c.parentId ? nameOf(c.parentId) : null, position: c.rawPosition ?? c.position ?? 0,
        overwrites: overwritesOf(c, guild.id, keyOf),
    }));
    const snap = { v: 1, takenAt: Date.now(), guild: Object.fromEntries(GUILD_KEYS.map((k) => [k, guild[k] ?? null])), everyonePermissions: bits(everyone?.permissions), roles, channels };
    snap.guild.afkChannel = guild.afkChannelId ? nameOf(guild.afkChannelId) : null; snap.guild.systemChannel = guild.systemChannelId ? nameOf(guild.systemChannelId) : null;
    return snap;
}
function serialize(snap) {
    if (snap.roles.length > MAX_ROLES || snap.channels.length > MAX_CHANNELS) throw new Error('This server is too big to back up.');
    const text = JSON.stringify(snap); if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('This server is too big to back up.'); return text;
}
function parseSnapshot(text) {
    let s; try { s = JSON.parse(text); } catch { return null; }
    return s && s.v === 1 && Array.isArray(s.roles) && Array.isArray(s.channels) ? s : null;
}

// What would a restore do? Compares the backup with what exists now. Never plans a deletion.
// current: { roles: [{ id, name }], channels: [{ id, name, type, parentName }] }
function planRestore(snap, current, { fixExisting = false, settings = false } = {}) {
    const roleByName = new Map(current.roles.map((r) => [r.name, r]));
    const rolesToCreate = snap.roles.filter((r) => !roleByName.has(r.name));
    const rolesToFix = fixExisting ? snap.roles.filter((r) => roleByName.has(r.name)) : [];
    const exists = (c) => current.channels.find((x) => x.name === c.name && x.type === c.type && (c.type === 4 || (x.parentName ?? null) === (c.parent ?? null)));
    const channelsToCreate = snap.channels.filter((c) => !exists(c)); const channelsToFix = fixExisting ? snap.channels.filter((c) => exists(c)) : [];
    return { rolesToCreate, rolesToFix, channelsToCreate, channelsToFix, settings, exists,
        summary: { rolesNew: rolesToCreate.length, channelsNew: channelsToCreate.length, rolesFix: rolesToFix.length, channelsFix: channelsToFix.length, settings,
            categoriesNew: channelsToCreate.filter((c) => c.type === 4).length } };
}
const describeType = (t) => TYPE_NAMES[t] ?? 'channel';

module.exports = { SUPPORTED, TYPE_NAMES, MAX_BYTES, buildSnapshot, serialize, parseSnapshot, planRestore, describeType };
