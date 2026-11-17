const { Events } = require('discord.js');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        await member.client.services.automodProcessor.handleJoin(member);
    },
};
