const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, AttachmentBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { respond } = require('../../moderation/helpers');
const { cleanReason } = require('../../utils/text');
const { cleanChannelName } = require('../../tickets/permissions');
const { buildTranscriptHtml } = require('../../tickets/transcript');
const { handleTicketComponent, performClose, panelPayload, memberIsStaff, collectMessages } = require('../../tickets/ticketFlow');

// Subcommands that change settings need "Manage Server". The rest work inside a ticket channel.
const ADMIN_SUBS = new Set(['enable', 'disable', 'category', 'log-channel', 'staff-add', 'staff-remove', 'max-open', 'ratings', 'status', 'panel']);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Support tickets.')
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('status').setDescription('Show the ticket settings and setup checks.'))
        .addSubcommand((s) => s.setName('enable').setDescription('Turn tickets ON.'))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn tickets OFF (open tickets stay open).'))
        .addSubcommand((s) => s.setName('category').setDescription('Where new ticket channels are created.')
            .addChannelOption((o) => o.setName('category').setDescription('A category').setRequired(true).addChannelTypes(ChannelType.GuildCategory)))
        .addSubcommand((s) => s.setName('log-channel').setDescription('Where transcripts and ticket logs are sent (staff only channel).')
            .addChannelOption((o) => o.setName('channel').setDescription('A text channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
        .addSubcommand((s) => s.setName('staff-add').setDescription('Let a role see and answer tickets.')
            .addRoleOption((o) => o.setName('role').setDescription('Staff role').setRequired(true)))
        .addSubcommand((s) => s.setName('staff-remove').setDescription('Stop a role from seeing new tickets.')
            .addRoleOption((o) => o.setName('role').setDescription('Staff role').setRequired(true)))
        .addSubcommand((s) => s.setName('max-open').setDescription('How many open tickets one member may have.')
            .addIntegerOption((o) => o.setName('amount').setDescription('1-10').setRequired(true).setMinValue(1).setMaxValue(10)))
        .addSubcommand((s) => s.setName('ratings').setDescription('Ask members to rate their ticket after it closes.')
            .addBooleanOption((o) => o.setName('enabled').setDescription('True = ask for a rating').setRequired(true)))
        .addSubcommand((s) => s.setName('panel').setDescription('Post the "Open a ticket" panel in a channel.')
            .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
            .addStringOption((o) => o.setName('title').setDescription('Panel title').setMaxLength(100))
            .addStringOption((o) => o.setName('description').setDescription('Panel text').setMaxLength(1000)))
        .addSubcommand((s) => s.setName('close').setDescription('Close this ticket.')
            .addStringOption((o) => o.setName('reason').setDescription('Why it is being closed').setMaxLength(300)))
        .addSubcommand((s) => s.setName('claim').setDescription('Claim this ticket (staff).'))
        .addSubcommand((s) => s.setName('add').setDescription('Add a member to this ticket (staff).')
            .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove a member from this ticket (staff).')
            .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)))
        .addSubcommand((s) => s.setName('rename').setDescription('Rename this ticket channel (staff).')
            .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(50)))
        .addSubcommand((s) => s.setName('transcript').setDescription('Get a transcript of this ticket so far (staff).')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const { tickets } = interaction.client.services;
        const guild = interaction.guild;

        if (!interaction.inGuild()) return respond(interaction, 'This command only works inside a server.');
        if (ADMIN_SUBS.has(sub) && !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return respond(interaction, 'You need the **Manage Server** permission to use this command.');
        }

        try {
            if (ADMIN_SUBS.has(sub)) return await adminCommand(interaction, sub, tickets, guild);

            // Everything below must be used inside a ticket channel.
            const ticket = tickets.getByChannel(interaction.channelId);
            if (!ticket || ticket.status !== 'open') return respond(interaction, 'This command only works inside an open ticket channel.');
            const config = tickets.getConfig(guild.id);
            const staff = memberIsStaff(interaction, config);

            if (sub === 'close') return await performClose(interaction, ticket.id, cleanReason(interaction.options.getString('reason')));
            if (!staff) return respond(interaction, 'Only staff can use this command.');

            switch (sub) {
                case 'claim': {
                    if (ticket.claimedBy === interaction.user.id) return respond(interaction, 'You already claimed this ticket.');
                    if (!tickets.claim(ticket.id, interaction.user.id)) return respond(interaction, `Already claimed by <@${tickets.getById(ticket.id).claimedBy}>.`);
                    return respond(interaction, `🙋 <@${interaction.user.id}> claimed this ticket.`);
                }
                case 'add': {
                    const user = interaction.options.getUser('user', true);
                    const member = await guild.members.fetch(user.id).catch(() => null);
                    if (!member) return respond(interaction, 'That user is not in this server.');
                    await interaction.channel.permissionOverwrites.edit(member, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
                    return respond(interaction, `✅ Added <@${user.id}> to this ticket.`);
                }
                case 'remove': {
                    const user = interaction.options.getUser('user', true);
                    if (user.id === ticket.openerId) return respond(interaction, 'You cannot remove the ticket owner. Close the ticket instead.');
                    await interaction.channel.permissionOverwrites.delete(user.id);
                    return respond(interaction, `✅ Removed <@${user.id}> from this ticket.`);
                }
                case 'rename': {
                    const name = cleanChannelName(interaction.options.getString('name', true));
                    await interaction.channel.setName(name);
                    return respond(interaction, `✅ Renamed to **${name}**.`);
                }
                case 'transcript': {
                    await interaction.deferReply();
                    const messages = await collectMessages(interaction.channel);
                    const opener = await interaction.client.users.fetch(ticket.openerId).catch(() => null);
                    const html = buildTranscriptHtml({ guildName: guild.name, ticket: { ...ticket, openerName: opener?.username }, messages });
                    return interaction.editReply({
                        content: `📄 Transcript so far (${messages.length} messages).`,
                        files: [new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `ticket-${String(ticket.number).padStart(4, '0')}.html` })],
                        allowedMentions: { parse: [] },
                    });
                }
            }
        } catch (error) {
            logger.error(`/ticket ${sub} failed in server ${guild.id}:`, error);
            return respond(interaction, error instanceof TypeError ? `⚠️ ${error.message}` : 'Something went wrong. Check my permissions and the bot console.');
        }
    },
};

async function adminCommand(interaction, sub, tickets, guild) {
    const me = await guild.members.fetchMe();
    switch (sub) {
        case 'enable': {
            const c = tickets.getConfig(guild.id);
            const missing = [];
            if (!c.categoryId) missing.push('a category (`/ticket category`)');
            if (!c.staffRoleIds.length) missing.push('a staff role (`/ticket staff-add`)');
            if (missing.length) return respond(interaction, `Before turning tickets on, set ${missing.join(' and ')}.`);
            if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) return respond(interaction, 'I need the **Manage Channels** permission first.');
            tickets.setEnabled(guild.id, true);
            return respond(interaction, '✅ Tickets are **ON**. Post the panel with `/ticket panel`.');
        }
        case 'disable':
            tickets.setEnabled(guild.id, false);
            return respond(interaction, '🛑 Tickets are **OFF**. The panel button will say tickets are closed. Existing tickets keep working.');
        case 'category': {
            const category = interaction.options.getChannel('category', true);
            tickets.setCategory(guild.id, category.id);
            return respond(interaction, `✅ New tickets will be created in **${category.name}**.`);
        }
        case 'log-channel': {
            const channel = interaction.options.getChannel('channel', true);
            if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles])) {
                return respond(interaction, `I can't post in ${channel}. Give me **View Channel**, **Send Messages**, **Embed Links** and **Attach Files** there.`);
            }
            tickets.setLogChannel(guild.id, channel.id);
            return respond(interaction, `✅ Transcripts and ticket logs will go to ${channel}. Make sure only staff can see it.`);
        }
        case 'staff-add': {
            const role = interaction.options.getRole('role', true);
            if (role.id === guild.id) return respond(interaction, 'You cannot use @everyone as a staff role.');
            return respond(interaction, tickets.addStaffRole(guild.id, role.id) ? `✅ <@&${role.id}> can now see and answer tickets.` : `<@&${role.id}> is already a staff role.`);
        }
        case 'staff-remove': {
            const role = interaction.options.getRole('role', true);
            return respond(interaction, tickets.removeStaffRole(guild.id, role.id) ? `✅ <@&${role.id}> is no longer a staff role (open tickets keep their access).` : 'That role was not a staff role.');
        }
        case 'max-open':
            tickets.setMaxOpen(guild.id, interaction.options.getInteger('amount', true));
            return respond(interaction, `✅ Each member may have up to **${interaction.options.getInteger('amount')}** open ticket(s).`);
        case 'ratings':
            tickets.setRatings(guild.id, interaction.options.getBoolean('enabled', true));
            return respond(interaction, interaction.options.getBoolean('enabled') ? '✅ Members will be asked to rate their ticket.' : '✅ Ratings are off.');
        case 'status': {
            const c = tickets.getConfig(guild.id);
            const category = c.categoryId ? guild.channels.cache.get(c.categoryId) : null;
            const logChannel = c.logChannelId ? guild.channels.cache.get(c.logChannelId) : null;
            const ok = (v, t) => `${v ? '✅' : '❌'} ${t}`;
            return respond(interaction, [
                `**Tickets: ${c.enabled ? 'ON' : 'OFF'}**`,
                `Category: ${category ? category.name : 'not set'}`,
                `Log channel: ${logChannel ? `<#${logChannel.id}>` : 'not set (no transcripts for staff)'}`,
                `Staff roles: ${c.staffRoleIds.length ? c.staffRoleIds.map((id) => `<@&${id}>`).join(' ') : 'none'}`,
                `Max open per member: ${c.maxOpenPerUser} · Ratings: ${c.ratingsEnabled ? 'on' : 'off'}`,
                '', '**Checks**',
                ok(me.permissions.has(PermissionFlagsBits.ManageChannels), 'Manage Channels'),
                ok(Boolean(category), 'Category exists'),
                ok(c.staffRoleIds.some((id) => guild.roles.cache.has(id)), 'At least one staff role exists'),
            ].join('\n'));
        }
        case 'panel': {
            const c = tickets.getConfig(guild.id);
            if (!c.enabled) return respond(interaction, 'Turn tickets on first with `/ticket enable`.');
            const channel = interaction.options.getChannel('channel') ?? interaction.channel;
            if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
                return respond(interaction, `I can't post in ${channel}.`);
            }
            await channel.send(panelPayload(
                interaction.options.getString('title') ?? 'Support',
                interaction.options.getString('description') ?? 'Need help? Press the button below to open a private ticket with our staff.'
            ));
            return respond(interaction, `✅ Panel posted in ${channel}.`);
        }
    }
}
