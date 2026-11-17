const { Events } = require('discord.js');
const { refreshPanel } = require('../../roles/panelFlow');

// When a role is deleted, forget it everywhere (panels, automatic roles, temporary roles).
module.exports = {
    name: Events.GuildRoleDelete,
    async execute(role) {
        const services = role.client.services;
        const affected = services.roles.listPanels(role.guild.id).filter((p) => services.roles.options(p.id).some((o) => o.roleId === role.id));
        services.roles.removeRoleEverywhere(role.guild.id, role.id);
        for (const panel of affected) await refreshPanel(role.guild, panel, services);
    },
};
