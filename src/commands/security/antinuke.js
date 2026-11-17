const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { respond } = require('../../moderation/helpers');
const { RULES, RULE_NAMES, buildThresholds } = require('../../antinuke/rules');

const RULE_CHOICES = RULE_NAMES.filter((r) => !RULES[r].single).map((r) => ({ name: RULES[r].label, value: r }));
// Subcommands that only VIEW things. Everything else changes settings and is owner-only.
const VIEW_ONLY = new Set(['status', 'trust-list', 'incidents', 'simulate']);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('antinuke')
        .setDescription('Protect the server against mass-deletion and other "nuke" attacks.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('status').setDescription('Show settings and setup checks.'))
        .addSubcommand((s) => s.setName('enable').setDescription('Turn anti-nuke ON (server owner only).'))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn anti-nuke OFF (server owner only).'))
        .addSubcommand((s) => s.setName('mode').setDescription('Alert only, or also contain attackers (owner only).')
            .addStringOption((o) => o.setName('mode').setDescription('What to do when a serious attack is detected').setRequired(true)
                .addChoices({ name: 'alert: only warn me (safest)', value: 'alert' }, { name: 'contain: also remove the attacker\'s dangerous roles', value: 'contain' })))
        .addSubcommand((s) => s.setName('sensitivity').setDescription('How quickly anti-nuke reacts (owner only).')
            .addStringOption((o) => o.setName('level').setDescription('Sensitivity').setRequired(true)
                .addChoices({ name: 'relaxed', value: 'relaxed' }, { name: 'balanced (default)', value: 'balanced' }, { name: 'strict', value: 'strict' })))
        .addSubcommand((s) => s.setName('alert-channel').setDescription('Where alerts are posted (owner only).')
            .addChannelOption((o) => o.setName('channel').setDescription('A private staff channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
        .addSubcommand((s) => s.setName('alert-role').setDescription('Optional: a role to ping when an alert is posted (owner only).')
            .addRoleOption((o) => o.setName('role').setDescription('The role to ping. Leave empty to stop pinging anyone.')))
        .addSubcommand((s) => s.setName('threshold').setDescription('Set a custom limit for one rule (owner only).')
            .addStringOption((o) => o.setName('rule').setDescription('Rule').setRequired(true).addChoices(...RULE_CHOICES))
            .addIntegerOption((o) => o.setName('count').setDescription('Actions allowed (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
            .addIntegerOption((o) => o.setName('seconds').setDescription('...within this many seconds (5-300)').setRequired(true).setMinValue(5).setMaxValue(300)))
        .addSubcommand((s) => s.setName('threshold-reset').setDescription('Go back to the default limit for a rule (owner only).')
            .addStringOption((o) => o.setName('rule').setDescription('Rule').setRequired(true).addChoices(...RULE_CHOICES)))
        .addSubcommand((s) => s.setName('trust-add').setDescription('Trust a bot, person or role, e.g. a ticket bot (owner only).')
            .addUserOption((o) => o.setName('user').setDescription('A person or bot'))
            .addRoleOption((o) => o.setName('role').setDescription('A role')))
        .addSubcommand((s) => s.setName('trust-remove').setDescription('Stop trusting a bot, person or role (owner only).')
            .addUserOption((o) => o.setName('user').setDescription('A person or bot'))
            .addRoleOption((o) => o.setName('role').setDescription('A role')))
        .addSubcommand((s) => s.setName('trust-list').setDescription('Show who is trusted.'))
        .addSubcommand((s) => s.setName('safemode').setDescription('Temporarily make anti-nuke much stricter (owner only).')
            .addIntegerOption((o) => o.setName('minutes').setDescription('How long (1-1440). Use 0 to turn off.').setRequired(true).setMinValue(0).setMaxValue(1440)))
        .addSubcommand((s) => s.setName('incidents').setDescription('Show recent incidents.'))
        .addSubcommand((s) => s.setName('simulate').setDescription('Post a harmless practice alert (changes nothing).')),

    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return respond(interaction, 'You need the **Administrator** permission to use this command.');
        }
        const sub = interaction.options.getSubcommand();
        // Changing settings is limited to the server owner, so a hacked admin cannot switch protection off.
        if (!VIEW_ONLY.has(sub) && interaction.user.id !== interaction.guild.ownerId) {
            return respond(interaction, '🔐 Only the **server owner** can change anti-nuke settings. Administrators can use `status`, `trust-list`, `incidents` and `simulate`.');
        }

        const { antinukeConfig: config, incidents, antinuke } = interaction.client.services;
        const guild = interaction.guild;
        try {
            switch (sub) {
                case 'status': return await status(interaction, config);
                case 'enable': {
                    config.setEnabled(guild.id, true);
                    const warn = !config.getEffective(guild.id).alertChannelId ? '\n⚠️ No alert channel is set yet. Use `/antinuke alert-channel`.' : '';
                    return respond(interaction, `✅ Anti-nuke is now **ON** (mode: ${config.getEffective(guild.id).configuredMode}). Run \`/antinuke status\` to check my permissions.${warn}`);
                }
                case 'disable':
                    config.setEnabled(guild.id, false);
                    return respond(interaction, '🛑 Anti-nuke is now **OFF**. Nothing is being watched. Turn it back on with `/antinuke enable`.');
                case 'mode': {
                    const mode = interaction.options.getString('mode');
                    config.setMode(guild.id, mode);
                    return respond(interaction, mode === 'contain'
                        ? '✅ Mode: **contain**. In a serious, high-severity attack I will remove the attacker\'s dangerous roles (reversible with the Restore button). I never ban or kick.'
                        : '✅ Mode: **alert**. I will only warn you; I take no action by myself.');
                }
                case 'sensitivity':
                    config.setSensitivity(guild.id, interaction.options.getString('level'));
                    return respond(interaction, `✅ Sensitivity set to **${interaction.options.getString('level')}**.`);
                case 'alert-channel': {
                    const channel = interaction.options.getChannel('channel');
                    const perms = channel.permissionsFor(await guild.members.fetchMe());
                    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
                        return respond(interaction, `I can't post in ${channel}. Give me **View Channel**, **Send Messages** and **Embed Links** there first.`);
                    }
                    config.setAlertChannel(guild.id, channel.id);
                    return respond(interaction, `✅ Alerts will be posted in ${channel}. Make sure only trusted staff can see it.`);
                }
                case 'alert-role': {
                    const role = interaction.options.getRole('role');
                    if (!role) {
                        config.setAlertRole(guild.id, null);
                        return respond(interaction, '✅ Alerts will not ping anyone. (Pinging a role is optional.)');
                    }
                    if (role.id === guild.id) return respond(interaction, 'Choose a real role, not @everyone. (I never ping @everyone.)');
                    const me = await guild.members.fetchMe();
                    config.setAlertRole(guild.id, role.id);
                    const canPing = role.mentionable || me.permissions.has(PermissionFlagsBits.MentionEveryone);
                    return respond(interaction, `✅ Alerts will ping ${role}.${canPing ? '' : '\n⚠️ That role is not mentionable and I lack **Mention Everyone**, so the ping will not notify anyone. Make the role mentionable in Server Settings → Roles.'}`);
                }
                case 'threshold': {
                    const rule = interaction.options.getString('rule');
                    const count = interaction.options.getInteger('count');
                    const seconds = interaction.options.getInteger('seconds');
                    config.setThreshold(guild.id, rule, count, seconds);
                    return respond(interaction, `✅ **${RULES[rule].label}**: alert at **${count}** within **${seconds}s** (never lower than 2 in practice).`);
                }
                case 'threshold-reset': {
                    const rule = interaction.options.getString('rule');
                    const changed = config.clearThreshold(guild.id, rule);
                    return respond(interaction, changed ? `✅ **${RULES[rule].label}** is back to its default.` : 'That rule already uses its default.');
                }
                case 'trust-add':
                case 'trust-remove': {
                    const user = interaction.options.getUser('user');
                    const role = interaction.options.getRole('role');
                    if ((user ? 1 : 0) + (role ? 1 : 0) !== 1) return respond(interaction, 'Choose exactly one: a `user` OR a `role`.');
                    const kind = user ? 'user' : 'role';
                    const id = user ? user.id : role.id;
                    if (role && role.id === guild.id) return respond(interaction, 'You cannot trust @everyone.');
                    const ok = sub === 'trust-add' ? config.addTrusted(guild.id, kind, id) : config.removeTrusted(guild.id, kind, id);
                    const label = user ? `<@${id}>` : `<@&${id}>`;
                    return respond(interaction, sub === 'trust-add'
                        ? (ok ? `✅ ${label} is now trusted (needs 3× more actions to count as suspicious).` : `${label} was already trusted.`)
                        : (ok ? `✅ ${label} is no longer trusted.` : `${label} was not on the trusted list.`));
                }
                case 'trust-list': {
                    const t = config.listTrusted(guild.id);
                    const lines = [...t.userIds.map((i) => `• <@${i}>`), ...t.roleIds.map((i) => `• <@&${i}>`)];
                    return respond(interaction, lines.length ? `**Trusted:**\n${lines.join('\n')}` : 'Nobody is trusted yet. Add ticket bots and similar with `/antinuke trust-add`.');
                }
                case 'safemode': {
                    const minutes = interaction.options.getInteger('minutes');
                    config.setSafeMode(guild.id, minutes);
                    return respond(interaction, minutes
                        ? `🛡️ **Safe mode ON** for ${minutes} minute(s): limits are halved and serious attacks are contained.`
                        : '✅ Safe mode is off.');
                }
                case 'incidents': {
                    const list = incidents.listIncidents(guild.id, 10);
                    if (!list.length) return respond(interaction, 'No incidents recorded. 🎉');
                    const lines = list.map((i) => `**#${i.number}** · ${i.severity} · ${i.status}${i.simulated ? ' · simulation' : ''} · ${i.actorId ? `<@${i.actorId}>` : 'unknown'} · <t:${Math.floor(Date.parse(i.createdAt) / 1000)}:R>`);
                    return respond(interaction, lines.join('\n'));
                }
                case 'simulate': {
                    if (!config.getEffective(guild.id).alertChannelId) return respond(interaction, 'Set an alert channel first with `/antinuke alert-channel`.');
                    await interaction.deferReply();
                    const incident = await antinuke.simulate(guild, interaction.user.id);
                    return respond(interaction, incident ? `🧪 Practice incident #${incident.number} posted. Nothing real was changed.` : 'I could not post in the alert channel. Check my permissions there.');
                }
            }
        } catch (error) {
            if (error instanceof TypeError) return respond(interaction, `⚠️ ${error.message}`);
            logger.error(`/antinuke ${sub} failed in server ${guild.id}:`, error);
            return respond(interaction, 'Something went wrong. Check the bot console.');
        }
    },
};

async function status(interaction, config) {
    const guild = interaction.guild;
    const cfg = config.getEffective(guild.id);
    const me = await guild.members.fetchMe();
    const check = (ok, text) => `${ok ? '✅' : '❌'} ${text}`;
    const alertChannel = cfg.alertChannelId ? guild.channels.cache.get(cfg.alertChannelId) : null;
    const canAlert = alertChannel?.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
    const thresholds = buildThresholds({ overrides: cfg.overrides, sensitivity: cfg.sensitivity, safe: cfg.safe });

    const limits = RULE_NAMES.filter((r) => !RULES[r].single)
        .map((r) => `${RULES[r].label}: **${thresholds[r].threshold}** / ${thresholds[r].windowSec}s${cfg.overrides[r] ? ' *(custom)*' : ''}`).join('\n');

    const embed = new EmbedBuilder()
        .setColor(cfg.enabled ? 0x2ecc71 : 0x95a5a6)
        .setTitle(`🛡️ Anti-nuke: ${cfg.enabled ? 'ON' : 'OFF'}`)
        .addFields(
            { name: 'Mode', value: `${cfg.mode}${cfg.safe ? ' (safe mode)' : ''}`, inline: true },
            { name: 'Sensitivity', value: cfg.sensitivity, inline: true },
            { name: 'Alert channel', value: alertChannel ? `${alertChannel}` : 'Not set', inline: true },
            { name: 'Alert role ping', value: cfg.alertRoleId && guild.roles.cache.has(cfg.alertRoleId) ? `<@&${cfg.alertRoleId}>` : 'Nobody (optional)', inline: true },
            { name: 'Setup checks', value: [
                check(me.permissions.has(PermissionFlagsBits.ViewAuditLog), 'View Audit Log (needed to know WHO did it)'),
                check(me.permissions.has(PermissionFlagsBits.ManageRoles), 'Manage Roles (needed to contain / revert)'),
                check(me.permissions.has(PermissionFlagsBits.ManageChannels), 'Manage Channels (recovery, lockdown)'),
                check(Boolean(canAlert), 'Can post in the alert channel'),
            ].join('\n') },
            { name: 'Current limits', value: limits },
            { name: 'Trusted', value: `${cfg.trustedUserIds.length} user(s), ${cfg.trustedRoleIds.length} role(s)`, inline: true },
        );
    if (cfg.safe) embed.addFields({ name: 'Safe mode until', value: `<t:${Math.floor(Date.parse(cfg.safeModeUntil) / 1000)}:R>`, inline: true });
    return respond(interaction, undefined, { embeds: [embed], content: null });
}
