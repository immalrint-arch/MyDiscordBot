// The safety rules for "who may moderate whom". This file has no Discord code in it,
// so it is easy to test. Every moderation command runs these checks first.
//
// moderator / target / bot each look like: { id: '123...', highestRolePosition: 5 }
// A higher position number means a more powerful role.
//
// Returns a message explaining the problem, or null if the action is allowed.
function checkHierarchy({ guildOwnerId, moderator, target, bot, botMustOutrank = true }) {
    if (target.id === moderator.id) {
        return 'You cannot moderate yourself.';
    }
    if (target.id === bot.id) {
        return 'I cannot moderate myself.';
    }
    if (target.id === guildOwnerId) {
        return 'The server owner cannot be moderated.';
    }

    // The owner may moderate anyone. Everyone else must outrank the target.
    const moderatorIsOwner = moderator.id === guildOwnerId;
    if (!moderatorIsOwner && target.highestRolePosition >= moderator.highestRolePosition) {
        return 'You cannot moderate someone whose highest role is equal to or above yours.';
    }

    // When the bot itself performs a Discord action (ban, kick, timeout, nickname),
    // Discord only allows it if the bot's role is above the target's role.
    if (botMustOutrank && target.highestRolePosition >= bot.highestRolePosition) {
        return "My highest role must be above that member's highest role. Move my role higher in Server Settings → Roles.";
    }

    return null;
}

module.exports = { checkHierarchy };
