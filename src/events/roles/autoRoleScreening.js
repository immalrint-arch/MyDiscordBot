const { Events } = require('discord.js');
const { applyAutoRoles } = require('../../roles/autoRoles');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        if (oldMember.pending === true && newMember.pending === false) await applyAutoRoles(newMember, 'join', newMember.client);
    },
};
