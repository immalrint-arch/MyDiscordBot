const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { LevelServiceError } = require('../../services/levelService');
const { roleProblem, moderatorRoleProblem } = require('../../roles/roleRules');

const PERM = PermissionFlagsBits.ManageRoles;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('levelrole')
        .setDescription('Optional reward roles given when people reach a level.')
        .setDefaultMemberPermissions(PERM)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('add').setDescription('Give this role at this level.')
            .addIntegerOption((o) => o.setName('level').setDescription('Level (1-500)').setRequired(true).setMinValue(1).setMaxValue(500))
            .addRoleOption((o) => o.setName('role').setDescription('The reward role').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove the reward at a level.')
            .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1).setMaxValue(500)))
        .addSubcommand((s) => s.setName('list').setDescription('Show the reward roles.'))
        .addSubcommand((s) => s.setName('mode').setDescription('Keep all earned roles, or only the newest one?')
            .addStringOption((o) => o.setName('mode').setDescription('Mode').setRequired(true)
                .addChoices({ name: 'Stack (keep every role earned)', value: 'stack' }, { name: 'Replace (only the highest earned)', value: 'replace' })))
        .addSubcommand((s) => s.setName('sync').setDescription('Give everyone online-cached the roles they already qualify for.')),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Roles'))) return;
        const { levels } = interaction.client.services;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        try {
            if (sub === 'list') {
                const list = levels.listLevelRoles(guild.id);
                if (!list.length) return respond(interaction, 'No level roles. They are optional. Add one with `/levelrole add`.');
                return respond(interaction, `Mode: **${levels.getConfig(guild.id).rewardMode}**\n${list.map((r) => `• Level **${r.level}** → <@&${r.roleId}>`).join('\n')}`);
            }
            if (sub === 'mode') { levels.setConfig(guild.id, { rewardMode: interaction.options.getString('mode', true) }); return respond(interaction, '✅ Level role mode updated.'); }
            if (sub === 'remove') {
                const level = interaction.options.getInteger('level', true);
                return respond(interaction, levels.removeLevelRole(guild.id, level) ? `✅ Removed the reward for level ${level}. People keep roles they already have.` : 'There is no reward at that level.');
            }
            if (sub === 'sync') {
                const { applyLevelRoles } = require('../../leveling/levelFlow');
                await interaction.deferReply();
                let changed = 0;
                for (const member of guild.members.cache.values()) {
                    if (member.user.bot) continue;
                    const { level } = levels.getUser(guild.id, member.id);
                    if (level > 0 && (await applyLevelRoles(member, level, interaction.client))) changed++;
                }
                return respond(interaction, `✅ Updated ${changed} member(s) that I can see. (I can only see members Discord has loaded.)`);
            }
            const level = interaction.options.getInteger('level', true);
            const role = interaction.options.getRole('role', true);
            const me = guild.members.me ?? await guild.members.fetchMe();
            const problem = roleProblem({ role, guildId: guild.id, botHighestPosition: me.roles.highest.position, forbidDangerous: true })
                ?? moderatorRoleProblem({ role, guildOwnerId: guild.ownerId, actorId: interaction.user.id, actorHighestPosition: interaction.member.roles.highest.position });
            if (problem) return respond(interaction, `⚠️ ${problem}`);
            levels.setLevelRole(guild.id, level, role.id);
            return respond(interaction, `✅ Reaching level **${level}** now gives <@&${role.id}>.`);
        } catch (error) {
            if (error instanceof LevelServiceError || error instanceof TypeError) return respond(interaction, `⚠️ ${error.message}`);
            throw error;
        }
    },
};
