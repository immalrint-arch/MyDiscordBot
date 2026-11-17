const { Events } = require('discord.js');
const { sendGoodbye } = require('../../welcome/greetingFlow');

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        if (!member.user) return;
        await sendGoodbye(member);
    },
};
