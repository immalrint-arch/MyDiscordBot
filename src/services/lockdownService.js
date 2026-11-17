const { ChannelType, PermissionFlagsBits } = require('discord.js');

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LOCKABLE = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const MAX_CHANNELS = 100; // safety cap for one lockdown

// Emergency lockdown: stops @everyone from sending messages in every text channel.
// It remembers what each channel looked like before, so /unlockdown restores it exactly,
// and it only ever reopens channels that IT closed (never ones locked on purpose with /lock).
function createLockdownService({ channelLocks, suppress, logger, sleep = defaultSleep }) {
    async function lockdown(guild, { moderatorId, reason }) {
        const me = await guild.members.fetchMe();
        const result = { locked: 0, alreadyLocked: 0, skipped: [], failed: [] };
        const channels = [...guild.channels.cache.values()].filter((c) => LOCKABLE.includes(c.type)).slice(0, MAX_CHANNELS);
        const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles];

        for (const channel of channels) {
            if (channelLocks.getLock(guild.id, channel.id)) { result.alreadyLocked++; continue; }
            if (!channel.permissionsFor(me)?.has(needed)) { result.skipped.push(`#${channel.name} (missing permission)`); continue; }

            const existing = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
            let previousState = 'neutral';
            if (existing?.allow.has(PermissionFlagsBits.SendMessages)) previousState = 'allow';
            else if (existing?.deny.has(PermissionFlagsBits.SendMessages)) previousState = 'deny';
            if (previousState === 'deny') { result.skipped.push(`#${channel.name} (already read-only)`); continue; }

            try {
                suppress.mark(guild.id, 'channel-update', channel.id); // the lockdown log covers this
                await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }, { reason: `Lockdown by ${moderatorId}: ${reason ?? 'no reason'}`.slice(0, 512) });
                channelLocks.saveLock({ guildId: guild.id, channelId: channel.id, previousState, lockedBy: moderatorId, source: 'lockdown' });
                result.locked++;
            } catch (error) {
                logger.warn(`Lockdown: could not lock #${channel.name} in server ${guild.id}: ${error.message}`);
                result.failed.push(`#${channel.name}`);
            }
            await sleep(250); // be gentle with Discord's rate limits
        }
        return result;
    }

    async function unlockdown(guild, { moderatorId, reason }) {
        const result = { unlocked: 0, failed: [], missing: 0 };
        const RESTORE = { allow: true, deny: false, neutral: null };

        for (const lock of channelLocks.listBySource(guild.id, 'lockdown')) {
            const channel = guild.channels.cache.get(lock.channelId);
            if (!channel) { channelLocks.clearLock(guild.id, lock.channelId); result.missing++; continue; }
            try {
                suppress.mark(guild.id, 'channel-update', channel.id);
                await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: RESTORE[lock.previousState] }, { reason: `Lockdown ended by ${moderatorId}: ${reason ?? 'no reason'}`.slice(0, 512) });
                channelLocks.clearLock(guild.id, lock.channelId);
                result.unlocked++;
            } catch (error) {
                logger.warn(`Unlockdown: could not unlock #${channel.name} in server ${guild.id}: ${error.message}`);
                result.failed.push(`#${channel.name}`);
            }
            await sleep(250);
        }
        return result;
    }

    return { lockdown, unlockdown };
}

module.exports = { createLockdownService, MAX_CHANNELS };
