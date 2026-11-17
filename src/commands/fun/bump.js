const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { BUMP_DELAY_MS } = require('../../fun/rules');

const PERM = PermissionFlagsBits.ManageGuild;
module.exports = {
    data: new SlashCommandBuilder().setName('bump').setDescription('Reminders to bump your server on a listing bot (like DISBOARD).').setDMPermission(false)
        .setDefaultMemberPermissions(PERM)
        .addSubcommand((s) => s.setName('setup').setDescription('Turn bump reminders on.')
            .addChannelOption((o) => o.setName('channel').setDescription('Where to remind (the channel where you bump)').setRequired(true).addChannelTypes(ChannelType.GuildText))
            .addRoleOption((o) => o.setName('role').setDescription('A role to ping (optional)')))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn bump reminders off.'))
        .addSubcommand((s) => s.setName('start').setDescription('Start the 2 hour timer now (if you just bumped and I missed it).'))
        .addSubcommand((s) => s.setName('status').setDescription('Show the bump reminder settings.')),
    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
        const { fun } = interaction.client.services; const { guild } = interaction; const sub = interaction.options.getSubcommand();
        if (sub === 'setup') { const c = interaction.options.getChannel('channel', true); const r = interaction.options.getRole('role'); fun.bump.setup(guild.id, { channelId: c.id, roleId: r?.id ?? null });
            return respond(interaction, `✅ Bump reminders on in <#${c.id}>${r ? ` (pinging <@&${r.id}>)` : ''}. When DISBOARD says "Bump done", I will remind you 2 hours later.`); }
        if (sub === 'disable') { fun.bump.disable(guild.id); return respond(interaction, '✅ Bump reminders are off.'); }
        const cfg = fun.bump.getConfig(guild.id);
        if (!cfg.channelId) return respond(interaction, 'Bump reminders are not set up. Use `/bump setup` first.');
        if (sub === 'start') { const at = fun.bump.start(guild.id, BUMP_DELAY_MS); return respond(interaction, `⏰ I will remind you <t:${Math.floor(at / 1000)}:R>.`); }
        return respond(interaction, [`**Bump reminders**`, `Channel: <#${cfg.channelId}>`, `Role: ${cfg.roleId ? `<@&${cfg.roleId}>` : 'none'}`, `Next reminder: ${cfg.waiting && cfg.nextAt ? `<t:${Math.floor(cfg.nextAt / 1000)}:R>` : 'waiting for the next bump'}`].join('\n'));
    },
};
