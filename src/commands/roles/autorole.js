const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { RoleServiceError } = require('../../services/roleService');
const { roleProblem, moderatorRoleProblem } = require('../../roles/roleRules');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autorole')
        .setDescription('Roles given to new members automatically.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('add').setDescription('Give this role to new members automatically.')
            .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true))
            .addStringOption((o) => o.setName('who').setDescription('Who gets it (default: people)')
                .addChoices({ name: 'People (not bots)', value: 'humans' }, { name: 'Bots only', value: 'bots' }, { name: 'Everyone', value: 'all' }))
            .addStringOption((o) => o.setName('when').setDescription('When it is given (default: on join)')
                .addChoices({ name: 'When they join', value: 'join' }, { name: 'After they pass verification', value: 'verified' })))
        .addSubcommand((s) => s.setName('remove').setDescription('Stop giving this role automatically.')
            .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('Show the automatic roles.')),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageRoles, 'Manage Roles'))) return;
        const { roles } = interaction.client.services;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        try {
            if (sub === 'list') {
                const list = roles.listAutoRoles(guild.id);
                if (!list.length) return respond(interaction, 'No automatic roles. Add one with `/autorole add`.');
                const who = { humans: 'people', bots: 'bots', all: 'everyone' };
                const when = { join: 'on join', verified: 'after verification' };
                return respond(interaction, list.map((r) => `• <@&${r.roleId}> — ${who[r.target]}, ${when[r.timing]}`).join('\n'));
            }
            const role = interaction.options.getRole('role', true);
            if (sub === 'remove') {
                return respond(interaction, roles.removeAutoRole(guild.id, role.id) ? `✅ <@&${role.id}> is no longer automatic.` : 'That role was not an automatic role.');
            }
            const me = guild.members.me ?? await guild.members.fetchMe();
            const problem = roleProblem({ role, guildId: guild.id, botHighestPosition: me.roles.highest.position, forbidDangerous: true })
                ?? moderatorRoleProblem({ role, guildOwnerId: guild.ownerId, actorId: interaction.user.id, actorHighestPosition: interaction.member.roles.highest.position });
            if (problem) return respond(interaction, `⚠️ ${problem}`);
            const timing = interaction.options.getString('when') ?? 'join';
            if (timing === 'verified' && !interaction.client.services.verification.getConfig(guild.id).enabled) {
                // allowed, but the person should know it waits for /verification
                await respond(interaction, 'ℹ️ Verification is not turned on yet, so this role will not be given until you set it up.');
            }
            roles.addAutoRole(guild.id, role.id, { target: interaction.options.getString('who') ?? 'humans', timing });
            const text = `✅ New members will get <@&${role.id}> automatically.`;
            return interaction.replied ? interaction.followUp({ content: text, allowedMentions: { parse: [] } }) : respond(interaction, text);
        } catch (error) {
            if (error instanceof RoleServiceError || error instanceof TypeError) return respond(interaction, `⚠️ ${error.message}`);
            throw error;
        }
    },
};
