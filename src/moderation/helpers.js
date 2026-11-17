const { MessageFlags } = require('discord.js');
const { checkHierarchy } = require('./hierarchy');
const { truncate, MAX_REASON_LENGTH } = require('../utils/text');

// An error whose message is safe to show to the moderator.
class UserFacingError extends Error {}

// Replies in the channel where the command was used (everyone who can see it sees the reply).
// Works whether or not we already called deferReply().
async function respond(interaction, content, extra = {}) {
    const payload = { content, allowedMentions: { parse: [] }, ...extra }; // parse: [] = never ping
    if (interaction.deferred || interaction.replied) {
        return interaction.editReply(payload);
    }
    return interaction.reply({ ...payload });
}

// Server admins can change who sees a command, so every command checks the
// permission again here instead of trusting Discord's menu alone.
async function ensureModerator(interaction, permission, permissionLabel) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(permission)) {
        await respond(interaction, `You need the **${permissionLabel}** permission to use this command.`);
        return false;
    }
    return true;
}

// Returns the GuildMember, or null if that person is not in the server.
async function fetchTargetMember(guild, userId) {
    try {
        return await guild.members.fetch(userId);
    } catch (error) {
        if (error.code === 10007) return null; // Discord's code for "Unknown Member"
        throw error;
    }
}

// Runs the hierarchy rules plus Discord's own flags (bannable, kickable, ...).
// Returns a message describing the problem, or null if everything is fine.
function guardMember(interaction, target, me, { botMustOutrank = true, apiFlag = null, actionLabel = 'moderate' } = {}) {
    const problem = checkHierarchy({
        guildOwnerId: interaction.guild.ownerId,
        moderator: {
            id: interaction.user.id,
            highestRolePosition: interaction.member.roles.highest.position,
        },
        target: { id: target.id, highestRolePosition: target.roles.highest.position },
        bot: { id: me.id, highestRolePosition: me.roles.highest.position },
        botMustOutrank,
    });
    if (problem) return problem;

    if (apiFlag && target[apiFlag] === false) {
        return `I can't ${actionLabel} that member. Check that my role is above theirs and that I have the right permission.`;
    }
    return null;
}

// Same safety rules for someone who is NOT in the server (for example banning by ID).
function guardOutsider(interaction, user, me) {
    return checkHierarchy({
        guildOwnerId: interaction.guild.ownerId,
        moderator: { id: interaction.user.id, highestRolePosition: interaction.member.roles.highest.position },
        target: { id: user.id, highestRolePosition: -1 }, // no roles at all
        bot: { id: me.id, highestRolePosition: me.roles.highest.position },
        botMustOutrank: false,
    });
}

// Tries to send a private message. Returns false if it fails (DMs closed, etc.).
async function tryDm(user, payload) {
    try {
        await user.send(payload);
        return true;
    } catch {
        return false;
    }
}

// The text that appears next to the action in Discord's own audit log.
function auditReason(interaction, reason) {
    return `${interaction.user.username}: ${reason ?? 'No reason provided'}`.slice(0, MAX_REASON_LENGTH);
}

// A short, safe description of an error for the moderator. Never includes secrets.
function describeError(error) {
    if (error instanceof UserFacingError) return error.message;
    if (typeof error?.code === 'number') {
        return `Discord said: ${truncate(String(error.message ?? 'error'), 120)} (code ${error.code})`;
    }
    return 'an unexpected error happened, check the bot console';
}

module.exports = {
    UserFacingError,
    respond,
    ensureModerator,
    fetchTargetMember,
    guardMember,
    guardOutsider,
    tryDm,
    auditReason,
    describeError,
};
