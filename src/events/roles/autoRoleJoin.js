const { Events } = require('discord.js');
const { applyAutoRoles } = require('../../roles/autoRoles');

// Automatic roles on join. Members who still have to accept the rules (screening) get them afterwards.
module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        if (member.pending) return;
        await applyAutoRoles(member, 'join', member.client);
    },
};
