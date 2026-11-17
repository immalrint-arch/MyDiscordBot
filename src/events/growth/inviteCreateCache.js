const { Events } = require('discord.js');
const { onInviteChange } = require('../../growth/growthFlow');

// Keeps the invite list up to date for the invite tracker.
module.exports = { name: Events.InviteCreate, execute(invite) { onInviteChange(invite, false); } };
