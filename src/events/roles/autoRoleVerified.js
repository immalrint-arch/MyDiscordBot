const { applyAutoRoles } = require('../../roles/autoRoles');

module.exports = {
    name: 'incomuMemberVerified',
    async execute(member) {
        await applyAutoRoles(member, 'verified', member.client);
    },
};
