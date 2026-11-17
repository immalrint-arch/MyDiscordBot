const { Events, AuditLogEvent, ChannelType } = require('discord.js');
const { COLORS, logEmbed, channelButton, actorText } = require('../logging/style');
const { line, readableChannelType, stamp, truncate } = require('../logging/textFormat');

// Turns a channel's permission overwrites into a simple map: id -> "allowBits:denyBits".
function overwriteMap(channel) {
    const map = new Map();
    if (!channel.permissionOverwrites?.cache) return map;
    for (const o of channel.permissionOverwrites.cache.values()) {
        map.set(o.id, `${o.allow.bitfield}:${o.deny.bitfield}`);
    }
    return map;
}

// Reference image 11: "Channel Updated" with a list of changes.
module.exports = {
    name: Events.ChannelUpdate,
    async execute(oldChannel, newChannel) {
        if (!newChannel.guild) return;
        const { logs, audit, suppress } = newChannel.client.services;

        // Our own /lock, /unlock and /slowmode already logged their change.
        if (suppress.isSuppressed(newChannel.guild.id, 'channel-update', newChannel.id)) return;

        const changes = [];
        if (oldChannel.name !== newChannel.name) changes.push(`• **Name:** #${oldChannel.name} → **#${newChannel.name}**`);
        if (oldChannel.topic !== newChannel.topic) {
            changes.push(`• **Topic:** ${truncate(oldChannel.topic ?? '(none)', 100)} → **${truncate(newChannel.topic ?? '(none)', 100)}**`);
        }
        if (oldChannel.nsfw !== newChannel.nsfw) changes.push(`• **Age-restricted:** ${oldChannel.nsfw} → **${newChannel.nsfw}**`);
        if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
            changes.push(`• **Slowmode:** ${oldChannel.rateLimitPerUser ?? 0}s → **${newChannel.rateLimitPerUser ?? 0}s**`);
        }
        if (oldChannel.userLimit !== newChannel.userLimit) {
            changes.push(`• **User limit:** ${oldChannel.userLimit ?? 0} → **${newChannel.userLimit ?? 0}**`);
        }
        if (oldChannel.parentId !== newChannel.parentId) {
            changes.push(`• **Category:** ${oldChannel.parentId ? `<#${oldChannel.parentId}>` : '(none)'} → **${newChannel.parentId ? `<#${newChannel.parentId}>` : '(none)'}**`);
        }

        // Permission overwrites: who was added, removed or changed.
        const before = overwriteMap(oldChannel);
        const after = overwriteMap(newChannel);
        const mention = (id) => (newChannel.guild.roles.cache.has(id) ? `<@&${id}>` : `<@${id}>`);
        for (const [id, value] of after) {
            if (!before.has(id)) changes.push(`• **Permissions added for** ${mention(id)}`);
            else if (before.get(id) !== value) changes.push(`• **Permissions changed for** ${mention(id)}`);
        }
        for (const id of before.keys()) {
            if (!after.has(id)) changes.push(`• **Permissions removed for** ${mention(id)}`);
        }

        // Moving a channel only changes its position, which also happens to many channels
        // at once when something is reordered. We only log it when nothing else changed.
        if (changes.length === 0 && oldChannel.rawPosition !== newChannel.rawPosition) {
            changes.push(`• **Position:** ${oldChannel.rawPosition} → **${newChannel.rawPosition}**`);
        }
        if (changes.length === 0) return;

        const entry = await audit.findEntry(newChannel.guild, AuditLogEvent.ChannelUpdate, { targetId: newChannel.id });
        const type = readableChannelType(ChannelType[newChannel.type]);
        const embed = logEmbed({
            color: COLORS.blue,
            title: 'Channel Updated',
            headline: `The ${type.toLowerCase()} channel <#${newChannel.id}> was updated.`,
            lines: [line('Type', type), line('Updated by', actorText(entry)), '', '**Changes**', ...changes.slice(0, 15)],
            footer: [`Time: ${stamp(new Date(), 'f')}`, `Channel \`${newChannel.id}\``],
        });
        await logs.send(newChannel.guild, 'channels', {
            embeds: [embed],
            components: [channelButton(newChannel.guild.id, newChannel.id)],
        });
    },
};
