const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, AttachmentBuilder, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const logger = require('../utils/logger');
const { truncate } = require('../logging/textFormat');
const { buildOverwrites, isStaff, ticketChannelName } = require('./permissions');
const { buildTranscriptHtml } = require('./transcript');

const COLOR = 0x4e5058;
const MAX_TRANSCRIPT_MESSAGES = 1000;
const DELETE_DELAY_MS = 5000;
const opening = new Set(); // "guild:user" while a ticket is being created (stops double-click duplicates)

// ---------- small builders ----------

const GREEN = 0x2ecc71;
const YELLOW = 0xf1c40f;
const FOOTER = 'Incomu Tickets';

// The public panel (reference image 4): green bar, title, text, and a "Create ticket" button.
const panelPayload = (title, description) => ({
    embeds: [new EmbedBuilder().setColor(GREEN).setDescription(`**${title}**\n${description}`).setFooter({ text: FOOTER })],
    components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tk:open').setLabel('Create ticket').setEmoji('📩').setStyle(ButtonStyle.Secondary)
    )],
});

// Under the welcome message (reference image 1): a "Close" button, plus Claim for staff.
function ticketButtons(ticket) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tk:close:${ticket.id}`).setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tk:claim:${ticket.id}`).setLabel(ticket.claimedBy ? 'Unclaim' : 'Claim').setEmoji('🙋').setStyle(ButtonStyle.Secondary)
    );
}

// The green box in a new ticket (reference image 1).
function welcomeEmbed(ticket, details) {
    const lines = [];
    if (ticket.claimedBy) lines.push(`**Claimed by:** <@${ticket.claimedBy}>`, '');
    if (details) lines.push(`**Subject:** ${truncate(ticket.subject, 100)}`, `❯ ${truncate(details, 1000).split('\n').join('\n❯ ')}`, '');
    lines.push('Support will be with you shortly.', 'To close this press the close button');
    return new EmbedBuilder().setColor(GREEN).setDescription(lines.join('\n').slice(0, 4000)).setFooter({ text: FOOTER });
}

// The yellow "Ticket Closed by" line and the staff controls under it (reference image 3).
const closedEmbed = (closerId, reason, note) => new EmbedBuilder().setColor(YELLOW).setDescription(
    `Ticket Closed by <@${closerId}>${reason ? `\n**Reason:** ${truncate(reason, 300)}` : ''}${note ? `\n${note}` : ''}`
);
const controlsPayload = (ticketId) => ({
    embeds: [new EmbedBuilder().setColor(COLOR).setDescription('`Support team ticket controls`')],
    components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tk:tr:${ticketId}`).setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tk:op:${ticketId}`).setLabel('Open').setEmoji('🔓').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tk:del:${ticketId}`).setLabel('Delete').setEmoji('⛔').setStyle(ButtonStyle.Secondary)
    )],
});

// "Are you sure you would like to close this ticket?" (reference image 2)
const confirmPayload = (ticketId) => ({
    content: 'Are you sure you would like to close this ticket?',
    components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tk:cc:${ticketId}`).setLabel('Close').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`tk:cx:${ticketId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] },
});

const noMentions = { allowedMentions: { parse: [] } };
const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, ...noMentions });

function memberIsStaff(interaction, config) {
    return isStaff(
        { roleIds: [...(interaction.member?.roles?.cache?.keys?.() ?? [])], isAdministrator: interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) },
        config.staffRoleIds
    );
}

// ---------- opening ----------

// Someone pressed "Create ticket" on the panel.
async function openForm(interaction) {
    const { tickets } = interaction.client.services;
    const config = tickets.getConfig(interaction.guildId);
    if (!config.enabled) return interaction.reply(ephemeral('Tickets are currently closed.'));
    if (tickets.countOpenFor(interaction.guildId, interaction.user.id) >= config.maxOpenPerUser) {
        return interaction.reply(ephemeral(`You already have ${config.maxOpenPerUser === 1 ? 'an open ticket' : `${config.maxOpenPerUser} open tickets`}. Please use that one (or ask for it to be closed first).`));
    }
    // By default the ticket opens immediately (like the reference). A server can ask for a subject first.
    if (!config.askForm) return createTicket(interaction, { subject: 'No subject', details: null });

    const input = (id, label, style, max, min) => new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setMinLength(min).setRequired(true)
    );
    return interaction.showModal(
        new ModalBuilder().setCustomId('tk:create').setTitle('Create ticket').addComponents(
            input('subject', 'What is this about?', TextInputStyle.Short, 100, 3),
            input('details', 'Describe your issue', TextInputStyle.Paragraph, 1000, 10)
        )
    );
}

// Creates the private channel. `form` is given when the optional subject form was used.
async function createTicket(interaction, form = null) {
    const { client, guild, user } = interaction;
    const { tickets } = client.services;
    const config = tickets.getConfig(guild.id);
    const key = `${guild.id}:${user.id}`;

    if (!config.enabled) return interaction.reply(ephemeral('Tickets are currently closed.'));
    if (opening.has(key) || tickets.countOpenFor(guild.id, user.id) >= config.maxOpenPerUser) {
        return interaction.reply(ephemeral('You already have an open ticket.'));
    }
    const category = config.categoryId ? guild.channels.cache.get(config.categoryId) : null;
    if (!category || category.type !== ChannelType.GuildCategory) {
        return interaction.reply(ephemeral('Tickets are not fully set up yet (no category). Please tell a staff member.'));
    }
    const staffRoleIds = config.staffRoleIds.filter((id) => guild.roles.cache.has(id));
    if (staffRoleIds.length === 0) return interaction.reply(ephemeral('Tickets are not fully set up yet (no staff role). Please tell a staff member.'));

    opening.add(key);
    let channel = null;
    let ticket = null;
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const subject = form ? form.subject : interaction.fields.getTextInputValue('subject').trim();
        const details = form ? form.details : interaction.fields.getTextInputValue('details').trim();

        channel = await guild.channels.create({
            name: 'ticket-new',
            type: ChannelType.GuildText,
            parent: category.id,
            topic: `Ticket opened by ${user.username} (${user.id})`,
            permissionOverwrites: buildOverwrites({ everyoneId: guild.id, openerId: user.id, staffRoleIds, botId: client.user.id }),
            reason: `Ticket opened by ${user.username}`,
        });
        ticket = tickets.createTicket({ guildId: guild.id, channelId: channel.id, openerId: user.id, subject });
        await channel.setName(ticketChannelName(ticket.number));

        // Two lines of text above the green box (reference image 1): a welcome line for the member
        // and a call for staff. Only the member and the configured staff roles can ever be pinged.
        await channel.send({
            content: `<@${user.id}> ${config.welcomeMessage}\n${staffRoleIds.map((id) => `<@&${id}>`).join(' ')} ${config.staffMessage}`.slice(0, 1900),
            embeds: [welcomeEmbed(ticket, details)],
            components: [ticketButtons(ticket)],
            allowedMentions: { users: [user.id], roles: staffRoleIds },
        });
        await sendLog(guild, config, { embeds: [new EmbedBuilder().setColor(GREEN).setDescription(`### 🎫 Ticket #${ticket.number} opened\n**By:** <@${user.id}>${form ? `\n**Subject:** ${truncate(subject, 100)}` : ''}\n**Channel:** <#${channel.id}>`)] });
        return interaction.editReply({ content: `✅ Your ticket is ready: <#${channel.id}>`, ...noMentions });
    } catch (error) {
        logger.error(`Could not create a ticket in server ${guild.id}:`, error);
        if (ticket) tickets.discardTicket(ticket.id);
        if (channel) await channel.delete('Ticket creation failed').catch(() => {});
        const text = 'I could not create your ticket. Please tell a staff member (I may be missing **Manage Channels**).';
        return interaction.deferred ? interaction.editReply({ content: text, ...noMentions }) : interaction.reply(ephemeral(text));
    } finally {
        opening.delete(key);
    }
}

// ---------- claiming ----------

async function claimButton(interaction, ticketId) {
    const { tickets } = interaction.client.services;
    const ticket = tickets.getById(ticketId);
    if (!ticket || ticket.guildId !== interaction.guildId || ticket.status !== 'open') return interaction.reply(ephemeral('This ticket is no longer open.'));
    const config = tickets.getConfig(interaction.guildId);
    if (!memberIsStaff(interaction, config)) return interaction.reply(ephemeral('Only staff can claim tickets.'));

    let announcement;
    if (ticket.claimedBy === interaction.user.id) {
        tickets.unclaim(ticket.id, interaction.user.id);
        announcement = `↩️ <@${interaction.user.id}> released this ticket.`;
    } else if (!tickets.claim(ticket.id, interaction.user.id)) {
        return interaction.reply(ephemeral(`Already claimed by <@${tickets.getById(ticket.id).claimedBy}>.`));
    } else {
        announcement = `🙋 <@${interaction.user.id}> claimed this ticket.`;
    }
    const fresh = tickets.getById(ticket.id);
    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    const lines = (embed.data.description ?? '').split('\n');
    const withoutClaim = lines[0]?.startsWith('**Claimed by:**') ? lines.slice(2) : lines;
    embed.setDescription((fresh.claimedBy ? [`**Claimed by:** <@${fresh.claimedBy}>`, '', ...withoutClaim] : withoutClaim).join('\n'));
    await interaction.update({ embeds: [embed], components: [ticketButtons(fresh)], ...noMentions });
    return interaction.channel.send({ content: announcement, ...noMentions });
}

// ---------- closing ----------

// Checks that this person may close/handle the ticket. Returns the ticket or replies with the reason.
async function loadTicket(interaction, ticketId, { staffOnly = false, wantStatus = 'open' } = {}) {
    const { tickets } = interaction.client.services;
    const ticket = tickets.getById(ticketId);
    if (!ticket || ticket.guildId !== interaction.guildId || ticket.channelId !== interaction.channelId) {
        await interaction.reply(ephemeral('I cannot find that ticket any more.'));
        return null;
    }
    if (ticket.status !== wantStatus) {
        await interaction.reply(ephemeral(wantStatus === 'open' ? 'This ticket is already closed.' : 'This ticket is not closed.'));
        return null;
    }
    const staff = memberIsStaff(interaction, tickets.getConfig(interaction.guildId));
    if (staffOnly ? !staff : !(staff || interaction.user.id === ticket.openerId)) {
        await interaction.reply(ephemeral(staffOnly ? 'Only staff can use the ticket controls.' : 'Only the ticket owner or staff can close it.'));
        return null;
    }
    return ticket;
}

// The Close button: ask "Are you sure?" first (reference image 2).
async function closeButton(interaction, ticketId) {
    const ticket = await loadTicket(interaction, ticketId);
    if (!ticket) return;
    return interaction.reply(confirmPayload(ticket.id));
}

async function confirmClose(interaction, ticketId) {
    const ticket = await loadTicket(interaction, ticketId);
    if (!ticket) return;
    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => {}); // remove the "Are you sure?" message
    await closeTicket(interaction.guild, ticket, interaction.user, null, interaction.channel);
}

async function cancelClose(interaction, ticketId) {
    const ticket = await loadTicket(interaction, ticketId);
    if (!ticket) return;
    await interaction.deferUpdate();
    await interaction.message.delete().catch(() => {});
}

// Used by /ticket close (no confirmation: typing the command is already deliberate).
async function performClose(interaction, ticketId, reason) {
    const ticket = await loadTicket(interaction, ticketId);
    if (!ticket) return;
    await interaction.deferReply();
    const result = await closeTicket(interaction.guild, ticket, interaction.user, reason, interaction.channel);
    if (!result.ok) return interaction.editReply({ content: 'This ticket was already closed.', ...noMentions });
    return interaction.deleteReply().catch(() => {}); // the channel already shows "Ticket Closed by ..."
}

// Staff controls under a closed ticket.
async function transcriptButton(interaction, ticketId) {
    const ticket = await loadTicket(interaction, ticketId, { staffOnly: true, wantStatus: 'closed' });
    if (!ticket) return;
    await interaction.deferReply();
    const { file, count } = await buildTranscriptFile(interaction.guild, ticket, interaction.channel);
    return interaction.editReply({ content: `📄 Transcript (${count} messages).`, files: [file], ...noMentions });
}

async function reopenButton(interaction, ticketId) {
    const { tickets } = interaction.client.services;
    const ticket = await loadTicket(interaction, ticketId, { staffOnly: true, wantStatus: 'closed' });
    if (!ticket) return;
    if (!tickets.reopen(ticket.id)) return interaction.reply(ephemeral('This ticket is not closed.'));
    await interaction.deferUpdate();
    await interaction.channel.permissionOverwrites.edit(ticket.openerId, { SendMessages: true }).catch(() => {});
    await interaction.message.delete().catch(() => {}); // remove the controls
    await interaction.channel.send({
        content: `<@${ticket.openerId}>`,
        embeds: [new EmbedBuilder().setColor(GREEN).setDescription(`Ticket reopened by <@${interaction.user.id}>`)],
        allowedMentions: { users: [ticket.openerId] },
    });
}

async function deleteButton(interaction, ticketId) {
    const { tickets } = interaction.client.services;
    const ticket = await loadTicket(interaction, ticketId, { staffOnly: true, wantStatus: 'closed' });
    if (!ticket) return;
    await interaction.deferUpdate();
    const config = tickets.getConfig(interaction.guildId);
    const { file, count } = await buildTranscriptFile(interaction.guild, ticket, interaction.channel);
    await sendLog(interaction.guild, config, {
        embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription(`### 🗑️ Ticket #${ticket.number} deleted\n**Deleted by:** <@${interaction.user.id}>\n**Opened by:** <@${ticket.openerId}>\n**Messages:** ${count}`)],
        files: [file],
    });
    await interaction.channel.send({ content: `🗑️ Deleting this channel in ${DELETE_DELAY_MS / 1000} seconds…`, ...noMentions });
    const channel = interaction.channel;
    setTimeout(() => channel.delete(`Ticket #${ticket.number} deleted by ${interaction.user.username}`).catch(() => {}), DELETE_DELAY_MS);
}

async function collectMessages(channel) {
    const all = [];
    let before;
    while (all.length < MAX_TRANSCRIPT_MESSAGES) {
        const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (batch.size === 0) break;
        all.push(...batch.values());
        before = batch.last().id;
        if (batch.size < 100) break;
    }
    return all.reverse().map((m) => ({
        authorName: m.author.username, authorId: m.author.id, authorBot: m.author.bot,
        avatarUrl: m.author.displayAvatarURL?.({ size: 64 }) ?? '',
        createdAt: new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
        content: m.content, embedCount: m.embeds?.length ?? 0,
        attachments: [...(m.attachments?.values?.() ?? [])].map((a) => ({ name: a.name, url: a.url })),
    }));
}

async function sendLog(guild, config, payload) {
    if (!config.logChannelId) return;
    try {
        const channel = await guild.channels.fetch(config.logChannelId);
        if (channel?.isTextBased()) await channel.send({ ...payload, ...noMentions });
    } catch (error) {
        logger.warn(`Could not write to the ticket log channel in server ${guild.id}: ${error.message}`);
    }
}

async function buildTranscriptFile(guild, ticket, channel) {
    const opener = await guild.client.users.fetch(ticket.openerId).catch(() => null);
    let messages = [];
    try {
        messages = await collectMessages(channel);
    } catch (error) {
        logger.warn(`Could not read messages for the transcript of ticket #${ticket.number}: ${error.message}`);
    }
    const html = buildTranscriptHtml({ guildName: guild.name, ticket: { ...ticket, openerName: opener?.username }, messages });
    const name = `ticket-${String(ticket.number).padStart(4, '0')}.html`;
    return { file: new AttachmentBuilder(Buffer.from(html, 'utf8'), { name }), count: messages.length, name, html };
}

// Marks the ticket closed (first, so two clicks cannot both close it), sends the transcript to the
// log channel and the owner, locks the owner out of typing, and shows the staff controls.
// The channel is NOT deleted: staff choose Transcript / Open / Delete (reference image 3).
async function closeTicket(guild, ticket, closer, reason, channel) {
    const { tickets } = guild.client.services;
    if (!tickets.close(ticket.id, closer.id, reason)) return { ok: false };
    const closed = tickets.getById(ticket.id);
    const config = tickets.getConfig(guild.id);
    const opener = await guild.client.users.fetch(ticket.openerId).catch(() => null);

    await channel.permissionOverwrites.edit(ticket.openerId, { SendMessages: false }).catch(() => {});

    const { html, count, name } = await buildTranscriptFile(guild, closed, channel);
    const file = () => new AttachmentBuilder(Buffer.from(html, 'utf8'), { name });

    const summary = [
        `### 🔒 Ticket #${ticket.number} closed`, '',
        `**Opened by:** <@${ticket.openerId}>`, `**Closed by:** <@${closer.id}>`,
        `**Claimed by:** ${closed.claimedBy ? `<@${closed.claimedBy}>` : 'Nobody'}`,
        `**Messages:** ${count}`, `**Reason:** ${reason ?? 'No reason provided'}`,
    ].join('\n');
    await sendLog(guild, config, { embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription(summary)], files: [file()] });

    // Transcript and rating buttons for the ticket owner.
    let dmFailed = !opener;
    if (opener) {
        const components = config.ratingsEnabled ? [new ActionRowBuilder().addComponents(
            [1, 2, 3, 4, 5].map((n) => new ButtonBuilder().setCustomId(`tk:rate:${ticket.id}:${n}`).setLabel(`${n} ⭐`).setStyle(ButtonStyle.Secondary))
        )] : [];
        try {
            await opener.send({
                embeds: [new EmbedBuilder().setColor(COLOR).setDescription(
                    `### Your ticket in ${guild.name} was closed\n**Ticket:** #${ticket.number}\n**Reason:** ${reason ?? 'No reason provided'}\n\n${config.ratingsEnabled ? 'How was our support? Tap a rating below.' : 'A transcript is attached.'}`
                )],
                files: [file()],
                components,
            });
        } catch {
            dmFailed = true;
        }
    }

    await channel.send({ embeds: [closedEmbed(closer.id, reason, dmFailed ? '⚠️ I could not send the transcript to the ticket owner (their DMs are closed).' : null)], allowedMentions: { parse: [] } });
    await channel.send(controlsPayload(ticket.id));
    return { ok: true, dmFailed };
}

// ---------- rating (in the opener's private messages) ----------

async function rateTicket(interaction, ticketId, rating) {
    const { client, user } = interaction;
    const { tickets } = client.services;
    const ticket = tickets.getById(ticketId);
    if (!ticket || ticket.openerId !== user.id) return interaction.reply({ content: 'That rating is not for you.' });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !tickets.rate(ticket.id, rating)) {
        return interaction.reply({ content: 'This ticket was already rated. Thank you!' });
    }
    const guild = client.guilds.cache.get(ticket.guildId);
    if (guild) {
        await sendLog(guild, tickets.getConfig(guild.id), {
            embeds: [new EmbedBuilder().setColor(0xf1c40f).setDescription(`### ⭐ Ticket #${ticket.number} rated\n**By:** <@${user.id}>\n**Rating:** ${'⭐'.repeat(rating)} (${rating}/5)${ticket.claimedBy ? `\n**Handled by:** <@${ticket.claimedBy}>` : ''}`)],
        });
    }
    return interaction.update({
        embeds: [new EmbedBuilder().setColor(0x2ecc71).setDescription(`### Thanks for your feedback!\nYou rated ticket #${ticket.number}: ${'⭐'.repeat(rating)}`)],
        components: [],
    });
}

// Routes every "tk:" button and form. Registered in index.js.
async function handleTicketComponent(interaction) {
    const [, action, arg, extra] = interaction.customId.split(':');
    if (action === 'rate') return rateTicket(interaction, Number(arg), Number(extra));
    if (!interaction.inGuild()) return;
    switch (action) {
        case 'open': return openForm(interaction);
        case 'create': return createTicket(interaction);
        case 'claim': return claimButton(interaction, Number(arg));
        case 'close': return closeButton(interaction, Number(arg));
        case 'cc': return confirmClose(interaction, Number(arg));
        case 'cx': return cancelClose(interaction, Number(arg));
        case 'tr': return transcriptButton(interaction, Number(arg));
        case 'op': return reopenButton(interaction, Number(arg));
        case 'del': return deleteButton(interaction, Number(arg));
    }
}

module.exports = { handleTicketComponent, performClose, closeTicket, panelPayload, memberIsStaff, collectMessages, buildTranscriptFile };
