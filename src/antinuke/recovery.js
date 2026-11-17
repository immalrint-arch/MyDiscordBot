const { ChannelType } = require('discord.js');

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Channel types we know how to recreate.
const RECREATABLE = [
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildCategory,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildStageVoice,
];

// Recreates deleted roles and channels from their saved structure.
//
// Honest limits:
//  - New channels and roles get NEW IDs. Message history cannot come back.
//  - Members do not get the recreated roles back automatically.
//  - Role order is approximate; check Server Settings -> Roles afterwards.
//  - It goes one by one with a short pause, to respect Discord's rate limits.
async function recoverItems(guild, items, { logger, sleep = defaultSleep, reason = 'Incomu anti-nuke recovery' }) {
    const summary = { roles: 0, channels: 0, failed: [], skipped: [] };
    const idMap = new Map(); // old ID -> new ID

    const roleItems = items.filter((i) => i.kind === 'role').sort((a, b) => a.data.position - b.data.position);
    for (const item of roleItems) {
        try {
            const role = await guild.roles.create({
                name: item.data.name,
                color: item.data.color,
                hoist: item.data.hoist,
                mentionable: item.data.mentionable,
                permissions: BigInt(item.data.permissions),
                reason,
            });
            idMap.set(item.originalId, role.id);
            summary.roles++;
        } catch (error) {
            logger.warn(`Recovery: could not recreate role "${item.data.name}": ${error.message}`);
            summary.failed.push(`role ${item.data.name}`);
        }
        await sleep(300);
    }

    // Categories first, so channels can be placed inside them.
    const channelItems = items
        .filter((i) => i.kind === 'channel')
        .sort((a, b) => (b.data.type === ChannelType.GuildCategory) - (a.data.type === ChannelType.GuildCategory) || a.data.position - b.data.position);

    for (const item of channelItems) {
        const d = item.data;
        if (!RECREATABLE.includes(d.type)) {
            summary.skipped.push(`${d.name} (type not supported)`);
            continue;
        }
        try {
            const parentId = idMap.get(d.parentId) ?? (guild.channels.cache.has(d.parentId) ? d.parentId : null);
            const overwrites = d.overwrites
                .map((o) => ({ id: idMap.get(o.id) ?? o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) }))
                .filter((o) => guild.roles.cache.has(o.id) || guild.members.cache.has(o.id) || o.id === guild.id);

            const options = { name: d.name, type: d.type, parent: parentId, permissionOverwrites: overwrites, reason };
            if (d.type === ChannelType.GuildText || d.type === ChannelType.GuildAnnouncement) {
                options.topic = d.topic ?? undefined;
                options.nsfw = d.nsfw;
                options.rateLimitPerUser = d.rateLimitPerUser;
            } else if (d.type === ChannelType.GuildVoice || d.type === ChannelType.GuildStageVoice) {
                options.userLimit = d.userLimit;
            }

            const channel = await guild.channels.create(options);
            idMap.set(item.originalId, channel.id);
            summary.channels++;
        } catch (error) {
            logger.warn(`Recovery: could not recreate channel "${d.name}": ${error.message}`);
            summary.failed.push(`channel ${d.name}`);
        }
        await sleep(300);
    }

    return summary;
}

module.exports = { recoverItems, RECREATABLE };
