const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');

const PERM = PermissionFlagsBits.ManageGuild;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reportconfig')
        .setDescription('Choose where member reports (/report) go.')
        .setDefaultMemberPermissions(PERM)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('channel').setDescription('Set the staff channel that receives reports (keep it staff-only).')
            .addChannelOption((o) => o.setName('channel').setDescription('The staff channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
        .addSubcommand((s) => s.setName('ping-role').setDescription('Mention a role on every new report (leave empty to stop).')
            .addRoleOption((o) => o.setName('role').setDescription('The role to mention')))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn reports off.'))
        .addSubcommand((s) => s.setName('status').setDescription('Show the report settings.')),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
        const { reports } = interaction.client.services;
        const { guild } = interaction;
        switch (interaction.options.getSubcommand()) {
            case 'channel': {
                const channel = interaction.options.getChannel('channel', true);
                const me = await guild.members.fetchMe();
                const perms = channel.permissionsFor(me);
                if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return respond(interaction, `I need View Channel, Send Messages and Embed Links in <#${channel.id}>.`);
                reports.setConfig(guild.id, { channelId: channel.id });
                return respond(interaction, `✅ Reports now go to <#${channel.id}>. Make sure only staff can see that channel.`);
            }
            case 'ping-role': {
                const role = interaction.options.getRole('role');
                if (role && role.id === guild.id) return respond(interaction, 'Pinging @everyone on every report is not allowed. Pick a staff role.');
                reports.setConfig(guild.id, { pingRoleId: role?.id ?? null });
                return respond(interaction, role ? `✅ New reports will mention <@&${role.id}>.` : '✅ Reports will not mention any role.');
            }
            case 'disable': reports.setConfig(guild.id, { channelId: null }); return respond(interaction, '⛔ Reports are off. `/report` will say it is not set up.');
            default: {
                const c = reports.getConfig(guild.id);
                return respond(interaction, [`**Reports**`, `Channel: ${c.channelId ? `<#${c.channelId}>` : 'not set (reports are off)'}`, `Ping role: ${c.pingRoleId ? `<@&${c.pingRoleId}>` : 'none'}`, `Open reports: ${reports.countOpen(guild.id)}`].join('\n'));
            }
        }
    },
};
