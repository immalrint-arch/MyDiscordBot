const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { LevelServiceError } = require('../../services/levelService');
const { applyLevelRoles } = require('../../leveling/levelFlow');

const PERM = PermissionFlagsBits.ManageGuild;
const member = (o) => o.setName('member').setDescription('The member').setRequired(true);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('xp')
        .setDescription('Manage XP: change levels, ignore channels/roles, give boosts.')
        .setDefaultMemberPermissions(PERM)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('add').setDescription('Add (or take away, with a minus) XP.')
            .addUserOption(member).addIntegerOption((o) => o.setName('amount').setDescription('-1000000 to 1000000').setRequired(true).setMinValue(-1000000).setMaxValue(1000000)))
        .addSubcommand((s) => s.setName('set-level').setDescription('Set someone to an exact level.')
            .addUserOption(member).addIntegerOption((o) => o.setName('level').setDescription('0 to 500').setRequired(true).setMinValue(0).setMaxValue(500)))
        .addSubcommand((s) => s.setName('reset-member').setDescription('Reset one member to zero.').addUserOption(member))
        .addSubcommand((s) => s.setName('reset-all').setDescription('Reset EVERYONE to zero. Cannot be undone.')
            .addStringOption((o) => o.setName('confirm').setDescription('Type RESET to confirm').setRequired(true)))
        .addSubcommand((s) => s.setName('ignore-add').setDescription('No XP in this channel, or for this role.')
            .addChannelOption((o) => o.setName('channel').setDescription('Channel'))
            .addRoleOption((o) => o.setName('role').setDescription('Role')))
        .addSubcommand((s) => s.setName('ignore-remove').setDescription('Allow XP again.')
            .addChannelOption((o) => o.setName('channel').setDescription('Channel'))
            .addRoleOption((o) => o.setName('role').setDescription('Role')))
        .addSubcommand((s) => s.setName('ignore-list').setDescription('Show ignored channels and roles.'))
        .addSubcommand((s) => s.setName('boost-set').setDescription('Give a role extra XP (150 = 1.5x). Only the best boost counts.')
            .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
            .addIntegerOption((o) => o.setName('percent').setDescription('10 to 500').setRequired(true).setMinValue(10).setMaxValue(500)))
        .addSubcommand((s) => s.setName('boost-remove').setDescription('Remove a role boost.')
            .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((s) => s.setName('boost-list').setDescription('Show role boosts.')),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
        const { levels } = interaction.client.services;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        try {
            if (['add', 'set-level', 'reset-member'].includes(sub)) {
                const user = interaction.options.getUser('member', true);
                if (user.bot) return respond(interaction, 'Bots do not earn XP.');
                let text;
                if (sub === 'add') { const r = levels.addXp(guild.id, user.id, interaction.options.getInteger('amount', true)); text = `✅ <@${user.id}> now has **${r.xp.toLocaleString('en-US')} XP** (level ${r.level}).`; }
                if (sub === 'set-level') { const level = interaction.options.getInteger('level', true); levels.setLevel(guild.id, user.id, level); text = `✅ <@${user.id}> is now **level ${level}**.`; }
                if (sub === 'reset-member') text = levels.resetUser(guild.id, user.id) ? `♻️ <@${user.id}> was reset to zero.` : 'They had no XP.';
                const target = guild.members.cache.get(user.id);
                if (target) await applyLevelRoles(target, levels.getUser(guild.id, user.id).level, interaction.client).catch(() => {});
                return respond(interaction, text);
            }
            if (sub === 'reset-all') {
                if (interaction.options.getString('confirm', true).trim() !== 'RESET') return respond(interaction, 'Nothing changed. Type exactly `RESET` to confirm.');
                return respond(interaction, `♻️ Reset the XP of ${levels.resetGuild(guild.id)} member(s). Level roles people already have stay.`);
            }
            if (sub === 'ignore-list') {
                const list = levels.listIgnores(guild.id);
                return respond(interaction, list.length ? list.map((i) => `• ${i.kind === 'channel' ? `<#${i.id}>` : `<@&${i.id}>`}`).join('\n') : 'Nothing is ignored.');
            }
            if (sub === 'ignore-add' || sub === 'ignore-remove') {
                const channel = interaction.options.getChannel('channel'); const role = interaction.options.getRole('role');
                if (!channel && !role) return respond(interaction, 'Choose a channel or a role.');
                const done = [];
                for (const [kind, thing] of [['channel', channel], ['role', role]]) {
                    if (!thing) continue;
                    if (sub === 'ignore-add') levels.addIgnore(guild.id, kind, thing.id); else levels.removeIgnore(guild.id, kind, thing.id);
                    done.push(kind === 'channel' ? `<#${thing.id}>` : `<@&${thing.id}>`);
                }
                return respond(interaction, sub === 'ignore-add' ? `✅ No XP in/for ${done.join(' and ')}.` : `✅ XP allowed again in/for ${done.join(' and ')}.`);
            }
            if (sub === 'boost-list') {
                const list = levels.listBoosts(guild.id);
                return respond(interaction, list.length ? list.map((b) => `• <@&${b.roleId}> — ${b.percent}%`).join('\n') : 'No boosts.');
            }
            const role = interaction.options.getRole('role', true);
            if (sub === 'boost-remove') return respond(interaction, levels.removeBoost(guild.id, role.id) ? '✅ Boost removed.' : 'That role had no boost.');
            levels.setBoost(guild.id, role.id, interaction.options.getInteger('percent', true));
            return respond(interaction, `✅ <@&${role.id}> earns **${interaction.options.getInteger('percent')}%** XP.`);
        } catch (error) {
            if (error instanceof LevelServiceError || error instanceof TypeError) return respond(interaction, `⚠️ ${error.message}`);
            throw error;
        }
    },
};
