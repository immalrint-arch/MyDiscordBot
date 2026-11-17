// Modmail: members DM the bot, staff answer from a private channel.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, AttachmentBuilder, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const crypto = require('node:crypto');
const logger = require('../utils/logger');
const { respond, ensureModerator } = require('../moderation/helpers');
const { RELAY_COOLDOWN_MS, PICK_TTL_MS, TRANSCRIPT_MAX_MESSAGES, isInternal, channelNameFor, prepareForward, hasBody, formatTranscript } = require('./rules');

const NO_PING = { parse: [] };
const COLOR_MEMBER = 0x5865f2, COLOR_STAFF = 0x57f287, COLOR_INFO = 0xfee75c;
const cooldowns = new Map(); // user/channel id -> last relay time
const pending = new Map(); // token -> { userId, content, attachments, expires }

const tooFast = (key, nowMs) => { const last = cooldowns.get(key) ?? 0; if (nowMs - last < RELAY_COOLDOWN_MS) return true; cooldowns.set(key, nowMs); if (cooldowns.size > 2000) cooldowns.clear(); return false; };
const sweepPending = (nowMs) => { for (const [k, v] of pending) if (v.expires < nowMs) pending.delete(k); };
const isStaff = (member, cfg) => Boolean(member?.permissions?.has?.(PermissionFlagsBits.ManageGuild) || (cfg.staffRoleId && member?.roles?.cache?.has(cfg.staffRoleId)));
const attachmentsOf = (message) => [...(message.attachments?.values?.() ?? [])].map((a) => ({ name: a.name, url: a.url }));

function buildRelayEmbed({ text, files, extra }, { name, avatar, color, footer }) {
    const e = new EmbedBuilder().setColor(color).setAuthor({ name: String(name).slice(0, 80), iconURL: avatar ?? undefined }).setDescription(text || '*(attachment)*').setTimestamp();
    if (footer) e.setFooter({ text: footer });
    const lines = files.map((f) => `📎 [${f.name}](${f.url})`); if (extra) lines.push(`…and ${extra} more file(s) not shown.`);
    if (lines.length) e.addFields({ name: 'Files', value: lines.join('\n').slice(0, 1000) });
    return e;
}
const controlRow = (id) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mm:close:${id}`).setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
    new ButtonBuilder().setCustomId(`mm:block:${id}`).setLabel('Block member').setStyle(ButtonStyle.Secondary),
);

// Which servers can this person write to? (enabled, they are a member, not blocked, bot not blacklisted)
async function candidateGuilds(client, userId) {
    const { modmail, access } = client.services; const out = [];
    if (access?.isBlacklisted?.(userId) || access?.blacklist?.has?.(userId)) return out;
    for (const guild of client.guilds.cache.values()) {
        const cfg = modmail.getConfig(guild.id); if (!cfg.enabled || !cfg.categoryId) continue;
        if (modmail.isBlocked(guild.id, userId)) continue;
        const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
        if (member) out.push({ guild, member, cfg });
    }
    return out;
}

async function openConversation(client, { guild, member, cfg }, first) {
    const { modmail, cases } = client.services;
    const category = guild.channels.cache.get(cfg.categoryId);
    if (!category) throw new Error('missing category');
    const channel = await guild.channels.create({
        name: channelNameFor(member.user.username), type: ChannelType.GuildText, parent: category.id, topic: `Modmail with ${member.user.tag ?? member.user.username} (${member.id})`,
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: cfg.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] },
        ],
        reason: 'Modmail conversation',
    });
    let id;
    try { id = modmail.openThread(guild.id, member.id, channel.id); }
    catch (e) { await channel.delete('Duplicate modmail').catch(() => {}); throw e; }
    const days = (ms) => Math.floor((Date.now() - ms) / 86400000);
    let warns = 0; try { warns = cases?.countActiveWarnings?.(guild.id, member.id) ?? 0; } catch { /* optional */ }
    const info = new EmbedBuilder().setColor(COLOR_INFO).setTitle(`📬 New modmail #${id}`)
        .setDescription(`**${member.user.username}** (<@${member.id}>)\nAnything you type here is sent to them. Start a message with \`//\` to write a private note that is **not** sent.`)
        .addFields({ name: 'Account', value: `${days(member.user.createdTimestamp)} days old`, inline: true }, { name: 'In server', value: member.joinedTimestamp ? `${days(member.joinedTimestamp)} days` : 'unknown', inline: true },
            { name: 'Past modmails', value: String(Math.max(0, modmail.countOfUser(guild.id, member.id) - 1)), inline: true }, { name: 'Active warnings', value: String(warns), inline: true });
    await channel.send({ embeds: [info], components: [controlRow(id)], allowedMentions: NO_PING });
    await relayToStaff(channel, member.user, first);
    return { id, channel };
}

async function relayToStaff(channel, user, { content, attachments }) {
    const data = prepareForward(content, attachments);
    await channel.send({ embeds: [buildRelayEmbed(data, { name: user.username, avatar: user.displayAvatarURL?.(), color: COLOR_MEMBER })], allowedMentions: NO_PING });
}

// A person sent the bot a DM.
async function handleDirectMessage(message, { nowMs = Date.now() } = {}) {
    const client = message.client; const { modmail } = client.services; const user = message.author;
    if (!modmail || user.bot) return;
    const payload = { content: message.content, attachments: attachmentsOf(message) };
    if (!hasBody(payload.content, payload.attachments)) return;
    if (tooFast(`u:${user.id}`, nowMs)) { await message.react('⏳').catch(() => {}); return; }

    // already talking to a server? just forward.
    const open = modmail.openThreadsOfUser(user.id);
    if (open.length === 1) return forwardFromUser(client, open[0], user, payload, message);
    if (open.length > 1) return pickPrompt(message, payload, open.map((t) => ({ guild: client.guilds.cache.get(t.guildId), existing: t })).filter((x) => x.guild), nowMs);

    const cands = await candidateGuilds(client, user.id);
    if (!cands.length) { await message.reply({ content: 'I can’t pass messages on right now: none of your servers with me has modmail turned on (or you can’t use it).', allowedMentions: NO_PING }).catch(() => {}); return; }
    if (cands.length === 1) return startFor(client, cands[0], user, payload, message);
    return pickPrompt(message, payload, cands, nowMs);
}

async function forwardFromUser(client, thread, user, payload, message) {
    const channel = client.channels.cache.get(thread.channelId) ?? await client.channels.fetch(thread.channelId).catch(() => null);
    if (!channel) { client.services.modmail.close(thread.id, { closedBy: client.user.id, reason: 'Channel was deleted' }); await message.reply('That conversation was closed. Send a new message to start another.').catch(() => {}); return; }
    await relayToStaff(channel, user, payload); await message.react('✅').catch(() => {});
}
async function startFor(client, cand, user, payload, message) {
    try {
        const { id } = await openConversation(client, cand, payload);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`mm:uclose:${id}`).setLabel('Close conversation').setStyle(ButtonStyle.Secondary));
        await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR_INFO).setTitle(`📬 Sent to ${cand.guild.name}`).setDescription('Staff will reply here. Everything you write now goes to them.')], components: [row], allowedMentions: NO_PING });
    } catch (error) {
        logger.warn(`Modmail open failed: ${error.message}`);
        await message.reply('I couldn’t open the conversation. Please try again later.').catch(() => {});
    }
}
async function pickPrompt(message, payload, cands, nowMs) {
    sweepPending(nowMs); const token = crypto.randomBytes(6).toString('hex');
    pending.set(token, { userId: message.author.id, payload, expires: nowMs + PICK_TTL_MS });
    const menu = new StringSelectMenuBuilder().setCustomId(`mm:pick:${token}`).setPlaceholder('Choose a server')
        .addOptions(cands.slice(0, 25).map((c) => ({ label: c.guild.name.slice(0, 100), value: c.guild.id })));
    await message.reply({ content: 'Which server is this message for?', components: [new ActionRowBuilder().addComponents(menu)], allowedMentions: NO_PING }).catch(() => {});
}

// Staff typed in a modmail channel.
async function handleStaffMessage(message) {
    const client = message.client; const { modmail } = client.services;
    if (!modmail || !message.guildId || message.author.bot || !modmail.isThreadChannel(message.channelId)) return false;
    const thread = modmail.byChannel(message.channelId); if (!thread) return false;
    if (isInternal(message.content)) { await message.react('📝').catch(() => {}); return true; }
    const cfg = modmail.getConfig(message.guildId);
    if (!isStaff(message.member, cfg)) return true;
    const payload = { content: message.content, attachments: attachmentsOf(message) };
    if (!hasBody(payload.content, payload.attachments)) return true;
    if (tooFast(`c:${message.channelId}`, Date.now())) { await message.react('⏳').catch(() => {}); return true; }
    const user = await client.users.fetch(thread.userId).catch(() => null);
    const data = prepareForward(payload.content, payload.attachments);
    const name = cfg.anonymous ? 'Staff' : message.member?.displayName ?? message.author.username;
    try {
        if (!user) throw new Error('no user');
        await user.send({ embeds: [buildRelayEmbed(data, { name, avatar: cfg.anonymous ? null : message.author.displayAvatarURL?.(), color: COLOR_STAFF, footer: message.guild.name })], allowedMentions: NO_PING });
        await message.react('✅').catch(() => {});
    } catch { await message.react('❌').catch(() => {}); await message.reply({ content: 'I couldn’t DM this member (their DMs may be closed).', allowedMentions: NO_PING }).catch(() => {}); }
    return true;
}

// Close: exactly once, transcript to the log channel, tell the member, delete the channel.
async function closeConversation(client, thread, { closedBy, reason, byMember = false }) {
    const { modmail } = client.services;
    if (!modmail.close(thread.id, { closedBy, reason })) return false;
    const closed = modmail.get(thread.id);
    const guild = client.guilds.cache.get(thread.guildId); const channel = client.channels.cache.get(thread.channelId) ?? await client.channels.fetch(thread.channelId).catch(() => null);
    const user = await client.users.fetch(thread.userId).catch(() => null);
    if (guild && channel) {
        try {
            const cfg = modmail.getConfig(guild.id); const logCh = cfg.logChannelId && (guild.channels.cache.get(cfg.logChannelId) ?? await guild.channels.fetch(cfg.logChannelId).catch(() => null));
            const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
            const lines = [...(fetched?.values?.() ?? [])].reverse().slice(0, TRANSCRIPT_MAX_MESSAGES).filter((m) => !m.author.bot || m.embeds?.length).map((m) => {
                const e = m.embeds?.[0]; const fromBot = m.author.bot;
                return { at: m.createdTimestamp, author: fromBot ? (e?.author?.name ?? 'Bot') : `${m.author.username} (private note/staff)`, content: fromBot ? (e?.description ?? '') : m.content, attachments: [...(m.attachments?.values?.() ?? [])].map((a) => ({ name: a.name, url: a.url })) };
            });
            if (logCh?.send) {
                const text = formatTranscript({ guildName: guild.name, thread: closed, userLabel: user?.username ?? 'unknown', closedByLabel: byMember ? 'the member' : `<@${closedBy}>`.replace(/[<@>]/g, ''), lines });
                await logCh.send({ content: `🔒 Modmail #${thread.id} closed (member <@${thread.userId}>${byMember ? ', by the member' : `, by <@${closedBy}>`}).`, files: [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `modmail-${thread.id}.txt` })], allowedMentions: NO_PING });
            }
        } catch (e) { logger.warn(`Modmail transcript failed: ${e.message}`); }
        await channel.delete('Modmail closed').catch(() => {});
    }
    if (user) await user.send({ embeds: [new EmbedBuilder().setColor(COLOR_INFO).setTitle('🔒 Conversation closed').setDescription(`${guild?.name ?? 'The server'} closed this conversation.${reason ? `\n**Reason:** ${String(reason).slice(0, 300)}` : ''}\nSend a new message any time to start another.`)], allowedMentions: NO_PING }).catch(() => {});
    return true;
}

async function handleModmailComponent(interaction) {
    const client = interaction.client; const { modmail } = client.services; const [, action, arg] = interaction.customId.split(':');
    if (action === 'pick') {
        const p = pending.get(arg);
        if (!p || p.userId !== interaction.user.id || p.expires < Date.now()) return interaction.update({ content: 'That choice expired. Send your message again.', components: [] });
        pending.delete(arg); const guildId = interaction.values[0];
        await interaction.update({ content: 'Sending…', components: [] });
        const existing = modmail.openOf(guildId, interaction.user.id);
        const message = { author: interaction.user, reply: (o) => interaction.followUp(o), react: async () => {} };
        if (existing) return forwardFromUser(client, existing, interaction.user, p.payload, message);
        const cands = await candidateGuilds(client, interaction.user.id); const cand = cands.find((c) => c.guild.id === guildId);
        if (!cand) return interaction.followUp('That server isn’t available for modmail right now.');
        return startFor(client, cand, interaction.user, p.payload, message);
    }
    const thread = modmail.get(Number(arg));
    if (action === 'uclose') {
        if (!thread || thread.userId !== interaction.user.id) return interaction.reply({ content: 'That isn’t your conversation.', flags: MessageFlags.Ephemeral });
        if (thread.status !== 'open') return interaction.reply({ content: 'Already closed.', flags: MessageFlags.Ephemeral });
        await interaction.update({ components: [] }).catch(() => {});
        return void closeConversation(client, thread, { closedBy: interaction.user.id, reason: 'Closed by the member', byMember: true });
    }
    if (!thread || !interaction.guildId || thread.guildId !== interaction.guildId) return interaction.reply({ content: 'This conversation no longer exists.', flags: MessageFlags.Ephemeral });
    if (!isStaff(interaction.member, modmail.getConfig(interaction.guildId))) return interaction.reply({ content: 'Only staff can use this.', flags: MessageFlags.Ephemeral });
    if (thread.status !== 'open') return interaction.reply({ content: 'Already closed.', flags: MessageFlags.Ephemeral });
    if (action === 'close') { await interaction.reply({ content: 'Closing…', flags: MessageFlags.Ephemeral }); return void closeConversation(client, thread, { closedBy: interaction.user.id, reason: null }); }
    if (action === 'block') {
        modmail.block(thread.guildId, thread.userId, 'Blocked from the conversation', interaction.user.id);
        await interaction.reply({ content: '🚫 Member blocked and conversation closing.', flags: MessageFlags.Ephemeral });
        return void closeConversation(client, thread, { closedBy: interaction.user.id, reason: 'Blocked' });
    }
}

async function handleModmailCommand(interaction) {
    const { modmail } = interaction.client.services; const o = interaction.options; const g = interaction.guildId; const sub = o.getSubcommand();
    if (sub === 'close') {
        const thread = modmail.byChannel(interaction.channelId);
        if (!thread) return respond(interaction, 'Use this inside a modmail channel.', { ephemeral: true });
        if (!isStaff(interaction.member, modmail.getConfig(g))) return respond(interaction, 'Only staff can use this.', { ephemeral: true });
        await respond(interaction, '🔒 Closing this conversation…');
        return void closeConversation(interaction.client, thread, { closedBy: interaction.user.id, reason: o.getString('reason') });
    }
    if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    if (sub === 'setup') {
        const cat = o.getChannel('category', true), role = o.getRole('staff_role', true), log = o.getChannel('log_channel', true);
        modmail.setup(g, { categoryId: cat.id, staffRoleId: role.id, logChannelId: log.id, anonymous: o.getBoolean('anonymous') ?? false });
        return respond(interaction, `✅ Modmail is **on**. Members who DM me will get a private channel in **${cat.name}** that **${role.name}** can see. Transcripts go to <#${log.id}>.`);
    }
    if (sub === 'enable' || sub === 'disable') {
        try { modmail.setEnabled(g, sub === 'enable'); } catch (e) { return respond(interaction, e.message, { ephemeral: true }); }
        return respond(interaction, sub === 'enable' ? '✅ Modmail is **on**.' : '✅ Modmail is **off**. Open conversations stay open until closed.');
    }
    if (sub === 'status') {
        const c = modmail.getConfig(g);
        return respond(interaction, [`**Modmail:** ${c.enabled ? 'on' : 'off'}`, `Category: ${c.categoryId ? `<#${c.categoryId}>` : 'not set'}`, `Staff role: ${c.staffRoleId ? `<@&${c.staffRoleId}>` : 'not set'}`, `Log channel: ${c.logChannelId ? `<#${c.logChannelId}>` : 'not set'}`, `Staff names: ${c.anonymous ? 'hidden (shown as “Staff”)' : 'shown'}`, `Open conversations: ${modmail.countOpen(g)}`].join('\n'));
    }
    if (sub === 'block') { const u = o.getUser('user', true); modmail.block(g, u.id, o.getString('reason'), interaction.user.id); return respond(interaction, `🚫 <@${u.id}> can no longer use modmail here.`); }
    if (sub === 'unblock') { const u = o.getUser('user', true); return respond(interaction, modmail.unblock(g, u.id) ? `✅ <@${u.id}> can use modmail again.` : 'That member wasn’t blocked.'); }
    if (sub === 'blocked') {
        const list = modmail.listBlocked(g); return respond(interaction, list.length ? list.map((b) => `• <@${b.userId}>${b.reason ? ` — ${b.reason}` : ''}`).join('\n') : 'Nobody is blocked.');
    }
}

module.exports = { handleDirectMessage, handleStaffMessage, handleModmailComponent, handleModmailCommand, closeConversation, candidateGuilds, isStaff, pending, cooldowns };
