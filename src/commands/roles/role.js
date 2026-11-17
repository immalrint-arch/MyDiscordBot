const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond, ensureModerator, fetchTargetMember, guardMember, describeError } = require('../../moderation/helpers');
const { roleProblem, moderatorRoleProblem } = require('../../roles/roleRules');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { cleanReason } = require('../../utils/text');

const MAX_TEMP_MS = 365 * 24 * 60 * 60 * 1000;
const member = (o) => o.setName('member').setDescription('The member').setRequired(true);
const role = (o) => o.setName('role').setDescription('The role').setRequired(true);
const reason = (o) => o.setName('reason').setDescription('Why').setMaxLength(300);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('Give or take roles.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('add').setDescription('Give a role to a member.')
            .addUserOption(member).addRoleOption(role).addStringOption(reason))
        .addSubcommand((s) => s.setName('remove').setDescription('Take a role from a member.')
            .addUserOption(member).addRoleOption(role).addStringOption(reason))
        .addSubcommand((s) => s.setName('temp').setDescription('Give a role that disappears after some time.')
            .addUserOption(member).addRoleOption(role)
            .addStringOption((o) => o.setName('duration').setDescription('For example 30m, 2h, 7d (up to 365d)').setRequired(true))
            .addStringOption(reason))
        .addSubcommand((s) => s.setName('temp-list').setDescription('Show temporary roles.')
            .addUserOption((o) => o.setName('member').setDescription('Only this member')))
        .addSubcommand((s) => s.setName('strip').setDescription('Take away every role a member has (only roles I and you may manage).')
            .addUserOption(member).addStringOption(reason)),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageRoles, 'Manage Roles'))) return;
        const { roles } = interaction.client.services;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();

        if (sub === 'temp-list') {
            const user = interaction.options.getUser('member');
            const list = roles.listTempRoles(guild.id, user?.id ?? null);
            if (!list.length) return respond(interaction, 'No temporary roles right now.');
            return respond(interaction, list.map((t) => `• <@${t.userId}> — <@&${t.roleId}> ends <t:${Math.floor(t.expiresAt / 1000)}:R>`).join('\n'));
        }

        const user = interaction.options.getUser('member', true);
        const target = await fetchTargetMember(guild, user.id).catch(() => null);
        if (!target) return respond(interaction, 'That person is not in this server.');
        const me = guild.members.me ?? await guild.members.fetchMe();
        const why = cleanReason(interaction.options.getString('reason'));
        const blocked = guardMember(interaction, target, me, { botMustOutrank: true, actionLabel: 'change roles of' });
        if (blocked) return respond(interaction, `⚠️ ${blocked}`);

        try {
            if (sub === 'strip') {
                const removable = target.roles.cache.filter((r) => r.id !== guild.id && !r.managed
                    && r.position < me.roles.highest.position
                    && !moderatorRoleProblem({ role: r, guildOwnerId: guild.ownerId, actorId: interaction.user.id, actorHighestPosition: interaction.member.roles.highest.position }));
                if (!removable.size) return respond(interaction, 'There are no roles I can remove from that member.');
                await target.roles.remove([...removable.keys()], `Role strip by ${interaction.user.tag}${why ? `: ${why}` : ''}`);
                return respond(interaction, `✅ Removed ${removable.size} role(s) from <@${target.id}>.`);
            }

            const chosen = interaction.options.getRole('role', true);
            // For a moderator handing out roles, powerful roles are allowed only if the moderator outranks them.
            const problem = roleProblem({ role: chosen, guildId: guild.id, botHighestPosition: me.roles.highest.position })
                ?? moderatorRoleProblem({ role: chosen, guildOwnerId: guild.ownerId, actorId: interaction.user.id, actorHighestPosition: interaction.member.roles.highest.position });
            if (problem) return respond(interaction, `⚠️ ${problem}`);

            if (sub === 'add') {
                if (target.roles.cache.has(chosen.id)) return respond(interaction, 'They already have that role.');
                await target.roles.add(chosen.id, `By ${interaction.user.tag}${why ? `: ${why}` : ''}`);
                return respond(interaction, `✅ Gave <@&${chosen.id}> to <@${target.id}>.`);
            }
            if (sub === 'remove') {
                if (!target.roles.cache.has(chosen.id)) return respond(interaction, 'They do not have that role.');
                await target.roles.remove(chosen.id, `By ${interaction.user.tag}${why ? `: ${why}` : ''}`);
                roles.clearTempRole(guild.id, target.id, chosen.id);
                return respond(interaction, `✅ Removed <@&${chosen.id}> from <@${target.id}>.`);
            }
            if (sub === 'temp') {
                const ms = parseDuration(interaction.options.getString('duration', true));
                if (!ms || ms < 60 * 1000 || ms > MAX_TEMP_MS) return respond(interaction, 'Use a duration between `1m` and `365d`, like `2h` or `7d`.');
                if (!target.roles.cache.has(chosen.id)) await target.roles.add(chosen.id, `Temporary role by ${interaction.user.tag}`);
                roles.addTempRole({ guildId: guild.id, userId: target.id, roleId: chosen.id, expiresAt: Date.now() + ms, addedBy: interaction.user.id, reason: why });
                return respond(interaction, `✅ <@${target.id}> has <@&${chosen.id}> for **${formatDuration(ms)}**.`);
            }
        } catch (error) {
            return respond(interaction, `⚠️ ${describeError(error)}`);
        }
    },
};
