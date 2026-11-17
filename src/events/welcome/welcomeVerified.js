const { greetMember } = require('../../welcome/greetingFlow');

// The verification system announces "incomuMemberVerified" after someone passes the captcha.
module.exports = {
    name: 'incomuMemberVerified',
    async execute(member) {
        const config = member.client.services.welcome.get(member.guild.id, 'welcome');
        if (config.timing !== 'verified') return;
        await greetMember(member);
    },
};
