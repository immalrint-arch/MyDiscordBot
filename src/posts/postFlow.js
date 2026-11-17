// Embeds, scheduled posts and sticky messages.
const { EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const R = require('./rules');
const { respond, ensureModerator } = require('../moderation/helpers');
const { parseMessageLink } = require('../utils/messageLink');
const { formatDuration } = require('../utils/duration');
const { TextCommandUnsupported } = require('../textcommands/adapter');
const { PostServiceError } = require('../services/postService');

const P = PermissionFlagsBits;
const EMBED_PERM = P.ManageMessages, SCHEDULE_PERM = P.ManageGuild;
const NOBODY = { parse: [] };

function toEmbedBuilder(e) {
    const b = new EmbedBuilder().setColor(e.color ?? R.DEFAULT_COLOR);
    if (e.title) b.setTitle(e.title); if (e.description) b.setDescription(e.description); if (e.footer) b.setFooter({ text: e.footer });
    if (e.image) b.setImage(e.image); if (e.thumbnail) b.setThumbnail(e.thumbnail);
    return b;
}
// What is really sent. Only the chosen role can be pinged; nobody else, ever (no @everyone).
function buildPayload({ content = null, embed = null, pingRoleId = null }) {
    const text = [pingRoleId ? `<@&${pingRoleId}>` : null, content].filter(Boolean).join('\n');
    return { content: text || undefined, embeds: embed ? [toEmbedBuilder(embed)] : [], allowedMentions: pingRoleId ? { parse: [], roles: [pingRoleId] } : NOBODY };
}

// Can this person (and I) post here? Returns a sentence about the problem, or null.
function channelProblem(guild, channel, member, { embed = false, role = null } = {}) {
    if (!channel || channel.guildId !== guild.id || !channel.isTextBased?.()) return 'Pick a text channel of this server.';
    const need = [P.ViewChannel, P.SendMessages, ...(embed ? [P.EmbedLinks] : [])];
    const me = guild.members?.me;
    if (me && !channel.permissionsFor(me)?.has(need)) return `I need **View Channel**, **Send Messages**${embed ? ' and **Embed Links**' : ''} in <#${channel.id}>.`;
    if (member && !channel.permissionsFor(member)?.has([P.ViewChannel, P.SendMessages])) return `You cannot send messages in <#${channel.id}>, so you cannot post there through me.`;
    if (role && !role.mentionable) {
        if (me && !channel.permissionsFor(me)?.has(P.MentionEveryone)) return `**${role.name}** is not mentionable and I do not have **Mention Everyone**. Turn on "Allow anyone to @mention this role" for it.`;
        if (member && !channel.permissionsFor(member)?.has(P.MentionEveryone)) return `**${role.name}** is not mentionable and you do not have **Mention Everyone**.`;
    }
    return null;
}
const errText = (e) => (e?.code === 50013 || e?.code === 50001 ? 'I am missing permission there.' : e?.message ?? 'unknown error');

// ---------- /embed ----------
const FIELDS = ['title', 'description', 'color', 'footer', 'image', 'thumbnail'];
function embedModal(channelId) {
    const input = (id, label, style, max, required = false, ph = '') => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max).setPlaceholder(ph));
    return new ModalBuilder().setCustomId(`ep:send:${channelId}`).setTitle('Send an embed').addComponents(
        input('title', 'Title', TextInputStyle.Short, R.MAX_TITLE), input('description', 'Text', TextInputStyle.Paragraph, R.MAX_DESCRIPTION, true), input('color', 'Colour (#5865F2 or red, green, blue...)', TextInputStyle.Short, 20),
        input('image', 'Picture link (https://...)', TextInputStyle.Short, 500), input('footer', 'Footer', TextInputStyle.Short, R.MAX_FOOTER));
}
async function sendEmbed(interaction, channel, parts, { content = null, role = null }) {
    const built = R.buildEmbedData(parts); if (built.problem) return respond(interaction, `⚠️ ${built.problem}`);
    if (!built.embed && !content) return respond(interaction, '⚠️ Add a title, a description or a picture.');
    const problem = channelProblem(interaction.guild, channel, interaction.member, { embed: Boolean(built.embed), role }); if (problem) return respond(interaction, `⚠️ ${problem}`);
    const cleaned = content ? R.cleanText(content, R.MAX_CONTENT) : null; if (content && !cleaned) return respond(interaction, `⚠️ The message above the embed must be 1 to ${R.MAX_CONTENT} characters.`);
    try { await channel.send(buildPayload({ content: cleaned, embed: built.embed, pingRoleId: role?.id ?? null })); }
    catch (error) { logger.warn(`Embed send failed: ${error.message}`); return respond(interaction, `⚠️ I could not send it: ${errText(error)}`); }
    return respond(interaction, `✅ Sent to <#${channel.id}>.`);
}
async function handleEmbedCommand(interaction) {
    if (!(await ensureModerator(interaction, EMBED_PERM, 'Manage Messages'))) return;
    const o = interaction.options; const sub = o.getSubcommand(); const parts = Object.fromEntries(FIELDS.map((f) => [f, o.getString(f)]));
    if (sub === 'form') {
        const channel = o.getChannel('channel', true); const problem = channelProblem(interaction.guild, channel, interaction.member, { embed: true }); if (problem) return respond(interaction, `⚠️ ${problem}`);
        try { return await interaction.showModal(embedModal(channel.id)); } catch (error) { if (error instanceof TextCommandUnsupported) return respond(interaction, 'The form only works as a slash command. Use `/embed form`, or `!embed send channel:#general title:… description:…`.'); throw error; }
    }
    if (sub === 'send') return sendEmbed(interaction, o.getChannel('channel', true), parts, { content: o.getString('content'), role: o.getRole('ping') });
    // edit: change an embed that I posted
    const link = parseMessageLink(o.getString('message_link', true)); if (!link || link.guildId !== interaction.guildId) return respond(interaction, '⚠️ Paste a message link from this server (right-click a message → Copy Message Link).');
    const channel = await interaction.guild.channels.fetch(link.channelId).catch(() => null);
    const problem = channelProblem(interaction.guild, channel, interaction.member); if (problem) return respond(interaction, `⚠️ ${problem}`);
    const message = await channel.messages.fetch(link.messageId).catch(() => null);
    if (!message) return respond(interaction, '⚠️ I could not find that message.');
    if (message.author?.id !== interaction.client.user.id) return respond(interaction, '⚠️ I can only edit messages that I posted myself.');
    const old = message.embeds?.[0]; if (!old) return respond(interaction, '⚠️ That message has no embed to edit.');
    const given = Object.fromEntries(Object.entries(parts).filter(([, v]) => v)); if (!Object.keys(given).length) return respond(interaction, '⚠️ Say what to change (title, description, colour, footer, image or thumbnail).');
    const merged = { title: old.title, description: old.description, footer: old.footer?.text, image: old.image?.url, thumbnail: old.thumbnail?.url, color: old.color == null ? R.DEFAULT_COLOR : `#${old.color.toString(16).padStart(6, '0')}`, ...given };
    const built = R.buildEmbedData(merged); if (built.problem) return respond(interaction, `⚠️ ${built.problem}`); if (!built.embed) return respond(interaction, '⚠️ An embed cannot be empty.');
    try { await message.edit({ embeds: [toEmbedBuilder(built.embed)], allowedMentions: NOBODY }); } catch (error) { return respond(interaction, `⚠️ I could not edit it: ${errText(error)}`); }
    return respond(interaction, '✅ Embed updated.');
}
// The form from /embed form.
async function handlePostComponent(interaction) {
    const [, action, channelId] = interaction.customId.split(':');
    if (!interaction.isModalSubmit() || action !== 'send') return;
    const say = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: NOBODY });
    if (!interaction.guild || !interaction.memberPermissions?.has(EMBED_PERM)) return say('You need the **Manage Messages** permission.');
    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    const get = (f) => interaction.fields.getTextInputValue(f) || null;
    return sendEmbed(interaction, channel, { title: get('title'), description: get('description'), color: get('color'), image: get('image'), footer: get('footer') }, {});
}

// ---------- /schedule ----------
const everyText = (s) => formatDuration(s * 1000);
async function handleScheduleCommand(interaction) {
    if (!(await ensureModerator(interaction, SCHEDULE_PERM, 'Manage Server'))) return;
    const { posts } = interaction.client.services; const o = interaction.options; const g = interaction.guildId; const sub = o.getSubcommand();
    try {
        if (sub === 'remove') { const id = o.getInteger('id', true); return respond(interaction, posts.scheduled.remove(g, id) ? `🗑️ Scheduled post #${id} deleted.` : `There is no scheduled post #${id}.`); }
        if (sub === 'toggle') { const id = o.getInteger('id', true); const on = o.getBoolean('enabled', true); return respond(interaction, posts.scheduled.setEnabled(g, id, on) ? `✅ Scheduled post #${id} is **${on ? 'on' : 'off'}**.` : `There is no scheduled post #${id}.`); }
        if (sub === 'list') {
            const list = posts.scheduled.list(g);
            return respond(interaction, list.length ? ['**Scheduled posts**', ...list.map((p) => `**#${p.id}** ${p.enabled ? '✅' : '⛔'} <#${p.channelId}> · ${p.enabled ? `next <t:${Math.floor(p.nextRunAt / 1000)}:R>` : 'switched off'}${p.intervalSeconds ? ` · every ${everyText(p.intervalSeconds)}${p.maxRuns ? ` (${p.runs}/${p.maxRuns} done)` : ''}` : ' · once'} · ${R.preview({ content: p.content, embed: p.embed })}`)].join('\n').slice(0, 1950) : 'There are no scheduled posts. Add one with `/schedule add`.');
        }
        const channel = o.getChannel('channel', true); const role = o.getRole('ping'); const offset = o.getInteger('utc-offset') ?? 0;
        const when = R.parseWhen(o.getString('when', true), { now: Date.now(), utcOffset: offset }); if (when.problem) return respond(interaction, `⚠️ ${when.problem}`);
        const built = R.buildEmbedData({ title: o.getString('title'), description: o.getString('description'), color: o.getString('color'), image: o.getString('image') }); if (built.problem) return respond(interaction, `⚠️ ${built.problem}`);
        const rawText = o.getString('message'); const content = rawText ? R.cleanText(rawText, R.MAX_CONTENT) : null; if (rawText && !content) return respond(interaction, `⚠️ The message must be 1 to ${R.MAX_CONTENT} characters.`);
        if (!content && !built.embed) return respond(interaction, '⚠️ Add a `message`, or a `title` / `description` for an embed.');
        const problem = channelProblem(interaction.guild, channel, interaction.member, { embed: Boolean(built.embed), role }); if (problem) return respond(interaction, `⚠️ ${problem}`);
        const repeat = o.getString('repeat'); let intervalSeconds = null;
        if (repeat) { const { parseDuration } = require('../utils/duration'); const ms = parseDuration(repeat); if (!ms) return respond(interaction, '⚠️ Write the repeat time like `1d`, `12h` or `1w`.'); intervalSeconds = Math.round(ms / 1000); }
        const times = o.getInteger('times'); if (times && !intervalSeconds) return respond(interaction, '⚠️ `times` only makes sense together with `repeat`.');
        const id = posts.scheduled.add(g, { channelId: channel.id, content, embed: built.embed, pingRoleId: role?.id ?? null, runAt: when.at, intervalSeconds, maxRuns: times ?? null, createdBy: interaction.user.id });
        return respond(interaction, `✅ Scheduled post **#${id}** for <t:${Math.floor(when.at / 1000)}:F> (<t:${Math.floor(when.at / 1000)}:R>) in <#${channel.id}>${intervalSeconds ? `, then every ${everyText(intervalSeconds)}${times ? `, ${times} times in total` : ''}` : ''}.`);
    } catch (error) { if (error instanceof PostServiceError) return respond(interaction, `⚠️ ${error.message}`); throw error; }
}
async function sendScheduled(client, p) {
    const channel = await client.channels.fetch(p.channelId); if (!channel || channel.guildId !== p.guildId) throw new Error('the channel is gone');
    await channel.send(buildPayload(p));
}
async function postsTick(client, t = Date.now()) {
    const { posts } = client.services;
    for (const p of posts.scheduled.due(t)) {
        const tooLate = t - p.nextRunAt > R.MAX_LATE_MS;
        if (!posts.scheduled.claim(p, t)) continue; // someone else (or an earlier tick) already handled it
        if (tooLate) { logger.warn(`Scheduled post #${p.id} was more than a day late (bot offline?) and was skipped.`); continue; }
        try { await sendScheduled(client, p); posts.scheduled.succeed(p.id); }
        catch (error) {
            logger.warn(`Scheduled post #${p.id} failed: ${error.message}`);
            const off = p.intervalSeconds ? posts.scheduled.fail(p.id) : false;
            client.users.fetch(p.createdBy).then((u) => u.send({ content: `⚠️ Your scheduled post #${p.id} (<#${p.channelId}>) could not be sent: ${errText(error)}${off ? ' It was switched off after 3 failures. Fix the problem and use `/schedule toggle`.' : p.intervalSeconds ? '' : ' It was a one-time post, so it is gone.'}`, allowedMentions: NOBODY })).catch(() => {});
        }
    }
}
function startPostScheduler(client) {
    let running = false;
    const run = async () => { if (running) return; running = true; try { await postsTick(client); } catch (error) { logger.error('Scheduled posts check failed:', error); } finally { running = false; } };
    run(); return setInterval(run, 20 * 1000);
}

// ---------- /sticky ----------
const pending = new Map(); // channelId -> timer: at most one repost per burst of chat
const DEBOUNCE_MS = 4000;
async function repostSticky(client, guildId, channelId) {
    const { posts } = client.services; const s = posts.sticky.get(guildId, channelId); if (!s) return;
    const channel = await client.channels.fetch(channelId).catch(() => null); if (!channel?.isTextBased?.() || channel.guildId !== guildId) return;
    const me = channel.guild?.members?.me; if (me && !channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages, ...(s.embed ? [P.EmbedLinks] : [])])) return;
    if (s.lastMessageId) await channel.messages.delete(s.lastMessageId).catch(() => {});
    const sent = await channel.send(buildPayload(s)); posts.sticky.setLastMessage(guildId, channelId, sent.id);
}
async function handleStickyMessage(message, { delayMs = DEBOUNCE_MS } = {}) {
    if (!message.guild || message.author?.id === message.client.user?.id) return;
    const { posts } = message.client.services; if (!posts?.sticky.has(message.guild.id, message.channelId) || pending.has(message.channelId)) return;
    const timer = setTimeout(() => { pending.delete(message.channelId); repostSticky(message.client, message.guild.id, message.channelId).catch((e) => logger.warn(`Sticky repost failed: ${e.message}`)); }, delayMs);
    timer.unref?.(); pending.set(message.channelId, timer);
}
async function handleStickyCommand(interaction) {
    if (!(await ensureModerator(interaction, EMBED_PERM, 'Manage Messages'))) return;
    const { posts } = interaction.client.services; const o = interaction.options; const g = interaction.guildId; const sub = o.getSubcommand();
    try {
        if (sub === 'list') { const l = posts.sticky.list(g); return respond(interaction, l.length ? ['**Sticky messages**', ...l.map((s) => `<#${s.channelId}> · ${R.preview({ content: s.content, embed: s.embed })}`)].join('\n').slice(0, 1950) : 'There are no sticky messages. Add one with `/sticky set`.'); }
        const channel = o.getChannel('channel', true);
        if (sub === 'remove') {
            const s = posts.sticky.get(g, channel.id); if (!s) return respond(interaction, `There is no sticky message in <#${channel.id}>.`);
            posts.sticky.remove(g, channel.id); clearTimeout(pending.get(channel.id)); pending.delete(channel.id);
            if (s.lastMessageId) await channel.messages?.delete(s.lastMessageId).catch(() => {});
            return respond(interaction, `🗑️ Sticky message removed from <#${channel.id}>.`);
        }
        const style = o.getString('style') ?? 'embed'; const text = R.cleanText(o.getString('text', true), style === 'embed' ? R.MAX_DESCRIPTION : R.MAX_CONTENT); if (!text) return respond(interaction, '⚠️ The text is empty or too long.');
        let content = null, embed = null;
        if (style === 'plain') content = text; else { const built = R.buildEmbedData({ title: o.getString('title'), description: text, color: o.getString('color') }); if (built.problem) return respond(interaction, `⚠️ ${built.problem}`); embed = built.embed; }
        const problem = channelProblem(interaction.guild, channel, interaction.member, { embed: Boolean(embed) }); if (problem) return respond(interaction, `⚠️ ${problem}`);
        posts.sticky.set(g, { channelId: channel.id, content, embed, createdBy: interaction.user.id });
        try { await repostSticky(interaction.client, g, channel.id); } catch (error) { return respond(interaction, `⚠️ Saved, but I could not post it yet: ${errText(error)}`); }
        return respond(interaction, `📌 Sticky message set in <#${channel.id}>. It moves to the bottom after people chat.`);
    } catch (error) { if (error instanceof PostServiceError) return respond(interaction, `⚠️ ${error.message}`); throw error; }
}

module.exports = { buildPayload, toEmbedBuilder, channelProblem, handleEmbedCommand, handlePostComponent, handleScheduleCommand, postsTick, startPostScheduler, handleStickyCommand, handleStickyMessage, repostSticky, pending, embedModal };
