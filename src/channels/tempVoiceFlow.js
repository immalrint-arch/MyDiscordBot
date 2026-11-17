const { ChannelType, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const { renderRoomName } = require('./channelRules');

const creating = new Set(); // "guild:user" while a room is being made (stops double rooms)

// Someone joined the trigger channel: make them a room and move them in.
async function createRoomFor(member, triggerChannel, client) {
    const { channels } = client.services;
    const guild = member.guild;
    const key = `${guild.id}:${member.id}`;
    if (creating.has(key)) return null;
    const config = channels.getVoiceConfig(guild.id);
    if (!config.enabled || channels.countRooms(guild.id) >= channels.MAX_TEMP_ROOMS) return null;
    const me = guild.members.me;
    if (!me?.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers])) {
        logger.warn(`Temporary voice rooms need Manage Channels and Move Members in server ${guild.id}.`);
        return null;
    }
    creating.add(key);
    try {
        const parentId = config.categoryId ?? triggerChannel.parentId ?? null;
        const number = channels.countRooms(guild.id) + 1;
        const room = await guild.channels.create({
            name: renderRoomName(config.nameTemplate, { displayname: member.displayName, username: member.user.username, number }),
            type: ChannelType.GuildVoice,
            parent: parentId,
            userLimit: config.defaultLimit,
            permissionOverwrites: [
                // The owner may manage THEIR room only. Never anything server-wide.
                { id: member.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect] },
            ],
            reason: `Temporary voice room for ${member.user.tag}`,
        });
        channels.addRoom(guild.id, room.id, member.id);
        try {
            await member.voice.setChannel(room, 'Moved to their temporary room');
        } catch {
            // They left before we could move them: the cleanup below removes the empty room.
        }
        if (room.members.size === 0) await deleteRoom(room, client);
        return room;
    } catch (error) {
        logger.warn(`Could not create a temporary room in server ${guild.id}: ${error.message}`);
        return null;
    } finally {
        creating.delete(key);
    }
}

async function deleteRoom(channel, client) {
    client.services.channels.removeRoom(channel.id);
    await channel.delete('Temporary room is empty').catch((error) => {
        if (error.code !== 10003) logger.warn(`Could not delete temporary room ${channel.id}: ${error.message}`);
    });
}

// Called for every voice change.
async function handleVoiceChange(oldState, newState, client) {
    const guild = newState.guild ?? oldState.guild;
    if (!guild) return;
    const { channels } = client.services;

    if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const room = channels.getRoom(oldState.channelId);
        const channel = room ? guild.channels.cache.get(oldState.channelId) : null;
        if (room && !channel) channels.removeRoom(oldState.channelId); // already deleted
        else if (room && channel.members.size === 0) await deleteRoom(channel, client);
    }

    if (newState.channelId && newState.channelId !== oldState.channelId && newState.member && !newState.member.user.bot) {
        const config = channels.getVoiceConfig(guild.id);
        if (config.enabled && config.triggerChannelId === newState.channelId) {
            await createRoomFor(newState.member, newState.channel, client);
        }
    }
}

// At startup: forget rooms that no longer exist and delete empty ones left over.
async function cleanupRooms(client) {
    const { channels } = client.services;
    for (const room of channels.listRooms()) {
        const guild = client.guilds.cache.get(room.guildId);
        if (!guild) continue;
        const channel = guild.channels.cache.get(room.channelId);
        if (!channel) channels.removeRoom(room.channelId);
        else if (channel.members.size === 0) await deleteRoom(channel, client);
    }
}

module.exports = { createRoomFor, handleVoiceChange, cleanupRooms };
