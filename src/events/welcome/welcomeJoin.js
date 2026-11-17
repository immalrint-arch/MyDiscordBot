const { Events } = require('discord.js');
const { greetMember } = require('../../welcome/greetingFlow');

// Sends the welcome message when someone joins (unless it is set to wait for verification).
module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        const { welcome, verification } = member.client.services;
        const config = welcome.get(member.guild.id, 'welcome');
        if (!config.enabled && !config.dmEnabled) return;
        const waitForVerification = config.timing === 'verified' && verification.getConfig(member.guild.id).enabled;
        if (waitForVerification) return; // welcomeVerified.js sends it later
        await greetMember(member);
    },
};
