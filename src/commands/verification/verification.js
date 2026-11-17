const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const logger = require('../../utils/logger');
const { respond } = require('../../moderation/helpers');
const { DANGEROUS_PERMISSIONS } = require('../../antinuke/rules');
const { verificationPanel } = require('../../verification/verificationFlow');

// Why a role cannot be used for verification (null = fine).
// A "verified" role must never be powerful: anyone who solves a captcha gets it.
function roleProblem(role, guild, me, { allowPowerful = false } = {}) {
    if (role.id === guild.id) return 'You cannot use @everyone.';
    if (role.managed) return 'That role is managed by an integration or bot, so I cannot give it out.';
    if (role.comparePositionTo(me.roles.highest) >= 0) return 'That role is at or above my highest role. Move my role higher in Server Settings → Roles.';
    if (!allowPowerful) {
        const bad = DANGEROUS_PERMISSIONS.filter((p) => role.permissions.has(p));
        if (bad.length) return `That role has powerful permissions (${bad.join(', ')}). A verified role should be harmless, because everyone who passes gets it.`;
    }
    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verification')
        .setDescription('Captcha verification for new members.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('status').setDescription('Show the settings and setup checks.'))
        .addSubcommand((s) => s.setName('enable').setDescription('Turn verification ON.'))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn verification OFF.'))
        .addSubcommand((s) => s.setName('role').setDescription('The role members get after passing the captcha.')
            .addRoleOption((o) => o.setName('role').setDescription('Verified role').setRequired(true)))
        .addSubcommand((s) => s.setName('unverified-role').setDescription('Optional role given on join and removed after verifying (leave empty to remove the setting).')
            .addRoleOption((o) => o.setName('role').setDescription('Unverified role')))
        .addSubcommand((s) => s.setName('attempts').setDescription('Wrong answers allowed before a 10 minute wait.')
            .addIntegerOption((o) => o.setName('amount').setDescription('1-10').setRequired(true).setMinValue(1).setMaxValue(10)))
        .addSubcommand((s) => s.setName('panel').setDescription('Post the "Verification Required!" panel.')
            .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
            .addStringOption((o) => o.setName('title').setDescription('Panel heading').setMaxLength(60))),

    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return respond(interaction, 'You need the **Manage Server** permission to use this command.');
        }
        const sub = interaction.options.getSubcommand();
        const { verification } = interaction.client.services;
        const guild = interaction.guild;
        const me = await guild.members.fetchMe();

        try {
            switch (sub) {
                case 'role': {
                    const role = interaction.options.getRole('role', true);
                    const problem = roleProblem(role, guild, me);
                    if (problem) return respond(interaction, problem);
                    verification.setVerifiedRole(guild.id, role.id);
                    return respond(interaction, `✅ Members who pass will get <@&${role.id}>. Make sure your channels are only visible to this role (or hidden from @everyone).`);
                }
                case 'unverified-role': {
                    const role = interaction.options.getRole('role');
                    if (!role) { verification.setUnverifiedRole(guild.id, null); return respond(interaction, '✅ No unverified role will be used.'); }
                    const problem = roleProblem(role, guild, me);
                    if (problem) return respond(interaction, problem);
                    verification.setUnverifiedRole(guild.id, role.id);
                    return respond(interaction, `✅ New members get <@&${role.id}> on join; it is removed when they pass.`);
                }
                case 'attempts':
                    verification.setMaxAttempts(guild.id, interaction.options.getInteger('amount', true));
                    return respond(interaction, `✅ ${interaction.options.getInteger('amount')} wrong answer(s) allowed before a 10 minute wait.`);
                case 'enable': {
                    const c = verification.getConfig(guild.id);
                    const role = c.verifiedRoleId ? guild.roles.cache.get(c.verifiedRoleId) : null;
                    if (!role) return respond(interaction, 'Set the verified role first with `/verification role`.');
                    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return respond(interaction, 'I need the **Manage Roles** permission first.');
                    const problem = roleProblem(role, guild, me);
                    if (problem) return respond(interaction, problem);
                    verification.setEnabled(guild.id, true);
                    return respond(interaction, '✅ Verification is **ON**. Post the panel with `/verification panel`.');
                }
                case 'disable':
                    verification.setEnabled(guild.id, false);
                    return respond(interaction, '🛑 Verification is **OFF**.');
                case 'status': {
                    const c = verification.getConfig(guild.id);
                    const role = c.verifiedRoleId ? guild.roles.cache.get(c.verifiedRoleId) : null;
                    const unv = c.unverifiedRoleId ? guild.roles.cache.get(c.unverifiedRoleId) : null;
                    const ok = (v, t) => `${v ? '✅' : '❌'} ${t}`;
                    return respond(interaction, [
                        `**Verification: ${c.enabled ? 'ON' : 'OFF'}**`,
                        `Verified role: ${role ? `<@&${role.id}>` : 'not set'}`,
                        `Unverified role: ${unv ? `<@&${unv.id}>` : 'none'}`,
                        `Wrong answers allowed: ${c.maxAttempts}`, '', '**Checks**',
                        ok(me.permissions.has(PermissionFlagsBits.ManageRoles), 'I have Manage Roles'),
                        ok(Boolean(role) && !roleProblem(role, guild, me), 'Verified role exists, is below my role and is harmless'),
                        ok(!unv || !roleProblem(unv, guild, me), 'Unverified role (if any) is below my role'),
                    ].join('\n'));
                }
                case 'panel': {
                    const c = verification.getConfig(guild.id);
                    if (!c.enabled) return respond(interaction, 'Turn verification on first with `/verification enable`.');
                    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
                    if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
                        return respond(interaction, `I can't post in ${channel}.`);
                    }
                    await channel.send(verificationPanel(guild.name, interaction.options.getString('title') ?? 'Verification Required!'));
                    return respond(interaction, `✅ Panel posted in ${channel}.`);
                }
            }
        } catch (error) {
            logger.error(`/verification ${sub} failed in server ${guild.id}:`, error);
            return respond(interaction, error instanceof TypeError ? `⚠️ ${error.message}` : 'Something went wrong. Check the bot console.');
        }
    },
};
