const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const logger = require('../../utils/logger');
const { runMemberAction } = require('../../moderation/runMemberAction');
const { respond, ensureModerator, UserFacingError, describeError } = require('../../moderation/helpers');
const { planQuarantine, planRestore } = require('../../modextras/rules');
const { cleanReason } = require('../../utils/text');

const MOD = PermissionFlagsBits.ModerateMembers;
const MAX_CHANNELS_PER_SYNC = 300;

// Gives the quarantine role "no access" everywhere except the quarantine channel.
async function syncChannels(guild, role, quarantineChannelId, reason) {
    let done = 0; let failed = 0; let skipped = 0;
    const channels = [...guild.channels.cache.values()].filter((c) => !c.isThread?.() && c.permissionOverwrites);
    for (const channel of channels.slice(0, MAX_CHANNELS_PER_SYNC)) {
        const isSafeRoom = channel.id === quarantineChannelId;
        const existing = channel.permissionOverwrites.cache.get(role.id);
        const wantsDenied = !isSafeRoom && existing?.deny?.has(PermissionFlagsBits.ViewChannel);
        if (wantsDenied) { skipped++; continue; }
        try {
            await channel.permissionOverwrites.edit(role, isSafeRoom
                ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }
                : { ViewChannel: false }, { reason });
            done++;
        } catch { failed++; }
    }
    return { done, failed, skipped, total: channels.length, capped: channels.length > MAX_CHANNELS_PER_SYNC };
}

module.exports = {
    syncChannels,
    data: new SlashCommandBuilder()
        .setName('quarantine')
        .setDescription('Lock a member into one channel, then give their roles back later.')
        .setDefaultMemberPermissions(MOD)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('add').setDescription('Quarantine a member (their roles are saved and taken away).')
            .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true))
            .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512)))
        .addSubcommand((s) => s.setName('remove').setDescription('End a quarantine and give their roles back.')
            .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true))
            .addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(512)))
        .addSubcommand((s) => s.setName('setup').setDescription('Choose the quarantine role (and the one channel they can use). Needs Manage Server.')
            .addRoleOption((o) => o.setName('role').setDescription('Create an empty role first, e.g. "Quarantined", and pick it here').setRequired(true))
            .addChannelOption((o) => o.setName('channel').setDescription('The only channel quarantined members can see').addChannelTypes(ChannelType.GuildText)))
        .addSubcommand((s) => s.setName('sync').setDescription('Re-apply the lock to all channels (run after adding channels). Needs Manage Server.'))
        .addSubcommand((s) => s.setName('list').setDescription('Show who is quarantined right now.')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const { quarantine } = interaction.client.services;
        const { guild } = interaction;

        if (sub === 'add' || sub === 'remove') {
            const config = quarantine.getConfig(guild.id);
            const role = config.roleId ? guild.roles.cache.get(config.roleId) : null;
            if (!role) return respond(interaction, 'Quarantine is not set up yet. An admin must run `/quarantine setup` first.');
            const isAdd = sub === 'add';
            return runMemberAction(interaction, {
                type: isAdd ? 'quarantine' : 'unquarantine', pastTense: isAdd ? 'Quarantined' : 'Quarantine removed',
                resultTitle: isAdd ? 'Quarantine Result:' : 'Unquarantine Result:', resultListTitle: isAdd ? 'Quarantined:' : 'Released:',
                resultKind: isAdd ? undefined : 'undo',
                actionLabel: isAdd ? 'quarantine' : 'release', userPermission: MOD, userPermissionLabel: 'Moderate Members',
                botPermission: PermissionFlagsBits.ManageRoles, botPermissionLabel: 'Manage Roles', apiFlag: 'manageable', dm: 'after',
                precheck: (member) => {
                    if (role.managed || role.position >= guild.members.me.roles.highest.position) return 'The quarantine role is above my highest role (or is a bot role). Move my role higher, or pick another role with `/quarantine setup`.';
                    const has = member.roles.cache.has(role.id); const record = quarantine.get(guild.id, member.id);
                    if (isAdd && (record || has)) return 'That member is already quarantined.';
                    if (!isAdd && !record && !has) return 'That member is not quarantined.';
                    return null;
                },
                perform: async ({ member, user, auditReason }) => {
                    if (isAdd) {
                        const me = guild.members.me;
                        const plan = planQuarantine(member.roles.cache.map((r) => ({ id: r.id, managed: r.managed, isEveryone: r.id === guild.id, position: r.position })), role.id, me.roles.highest.position);
                        const stored = quarantine.add(guild.id, user.id, { roleIds: plan.saved, moderatorId: interaction.user.id, reason: cleanReason(interaction.options.getString('reason')) });
                        if (!stored) throw new UserFacingError('That member is already quarantined.');
                        try { await member.roles.set(plan.final, auditReason); } catch (error) { quarantine.take(guild.id, user.id); throw error; }
                        return;
                    }
                    const record = quarantine.take(guild.id, user.id);
                    const existing = new Map(guild.roles.cache.map((r) => [r.id, { managed: r.managed, position: r.position }]));
                    const restore = planRestore(record?.roleIds ?? [], existing, guild.members.me.roles.highest.position);
                    const current = member.roles.cache.filter((r) => r.id !== guild.id && r.id !== role.id).map((r) => r.id);
                    try { await member.roles.set([...new Set([...current, ...restore.give])], auditReason); } catch (error) {
                        if (record) quarantine.add(guild.id, user.id, { roleIds: record.roleIds, moderatorId: record.moderatorId, reason: record.reason });
                        throw error;
                    }
                },
            });
        }

        if (sub === 'list') {
            if (!(await ensureModerator(interaction, MOD, 'Moderate Members'))) return;
            const rows = quarantine.list(guild.id);
            if (!rows.length) return respond(interaction, 'Nobody is quarantined.');
            return respond(interaction, ['**Quarantined members**', ...rows.slice(0, 25).map((r) => `▸ <@${r.userId}> — ${r.reason ?? 'No reason'} (by <@${r.moderatorId}>)`), rows.length > 25 ? `…and ${rows.length - 25} more` : ''].filter(Boolean).join('\n'));
        }
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

        await interaction.deferReply();
        try {
            const me = await guild.members.fetchMe();
            if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return respond(interaction, 'I need the **Manage Roles** and **Manage Channels** permissions to set up quarantine.');
            }
            let role; let channelId;
            if (sub === 'setup') {
                role = interaction.options.getRole('role', true);
                channelId = interaction.options.getChannel('channel')?.id ?? null;
                if (role.id === guild.id) return respond(interaction, 'Use a separate role, not @everyone.');
                if (role.managed) return respond(interaction, 'That role belongs to a bot or integration. Create a normal empty role.');
                if (role.position >= me.roles.highest.position) return respond(interaction, 'That role is above my highest role. Move my role above it first.');
                if (role.permissions.bitfield !== 0n) return respond(interaction, 'That role has permissions. Use an empty role with no permissions (quarantine must not give anything).');
                quarantine.setConfig(guild.id, { roleId: role.id, channelId });
            } else {
                const config = quarantine.getConfig(guild.id);
                role = config.roleId ? guild.roles.cache.get(config.roleId) : null;
                channelId = config.channelId;
                if (!role) return respond(interaction, 'Quarantine is not set up yet. Run `/quarantine setup`.');
            }
            const result = await syncChannels(guild, role, channelId, `${interaction.user.username}: quarantine ${sub}`);
            const safeRoom = channelId ? `<#${channelId}>` : 'no channel (they see nothing)';
            return respond(interaction, [
                `✅ Quarantine role: <@&${role.id}> · Safe channel: ${safeRoom}`,
                `Updated **${result.done}** channels, ${result.skipped} were already locked${result.failed ? `, ❌ **${result.failed}** failed (my role may lack access to them)` : ''}.`,
                result.capped ? `⚠️ Only the first ${MAX_CHANNELS_PER_SYNC} of ${result.total} channels were handled.` : '',
                'Run `/quarantine sync` after you create new channels.',
            ].filter(Boolean).join('\n'));
        } catch (error) {
            logger.error(`quarantine ${sub} failed in server ${guild.id}:`, error);
            return respond(interaction, `Quarantine setup failed: ${describeError(error)}.`);
        }
    },
};
