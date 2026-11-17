const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const { bar, SUGGESTION_STATUS, starAction, emojiMatches } = require('./rules');

const NOBODY = { parse: [] };
const unix = (ms) => Math.floor(ms / 1000);
const PRIVATE = MessageFlags.Ephemeral;
const tell = (interaction, content) => interaction.reply({ content, flags: PRIVATE, allowedMentions: NOBODY });

// ===================== polls =====================
function pollPayload(poll, { rows, voters }) {
    const total = rows.reduce((n, r) => n + r.count, 0);
    const best = Math.max(0, ...rows.map((r) => r.count));
    const ended = poll.status === 'ended';
    const lines = poll.options.map((text, i) => {
        const r = rows[i]; const winner = ended && best > 0 && r.count === best;
        return `**${i + 1}.** ${text}${winner ? ' 🏆' : ''}\n${bar(r.percent)} **${r.count}** · ${r.percent}%`;
    });
    const info = [poll.multiple ? 'Pick as many as you like' : 'Pick one (press again to remove)', `${voters} voter${voters === 1 ? '' : 's'}`];
    if (ended) info.push('**Poll ended**'); else if (poll.endsAt) info.push(`Ends <t:${unix(poll.endsAt)}:R>`);
    const embed = new EmbedBuilder().setColor(ended ? 0x95a5a6 : 0x5865f2).setTitle(`📊 ${poll.question}`)
        .setDescription(`${lines.join('\n\n')}\n\n${info.join(' · ')}`.slice(0, 4000)).setFooter({ text: `Poll #${poll.number}` });
    const components = [];
    if (!ended) {
        for (let start = 0; start < poll.options.length; start += 5) {
            components.push(new ActionRowBuilder().addComponents(poll.options.slice(start, start + 5).map((_, k) =>
                new ButtonBuilder().setCustomId(`pl:v:${poll.id}:${start + k}`).setLabel(String(start + k + 1)).setStyle(ButtonStyle.Secondary))));
        }
    }
    return { embeds: [embed], components, allowedMentions: NOBODY };
}

async function handlePollButton(interaction) {
    const [, , rawId, rawIndex] = interaction.customId.split(':');
    const { polls } = interaction.client.services;
    const poll = polls.getById(Number(rawId));
    if (!poll || poll.guildId !== interaction.guildId) return tell(interaction, 'This poll does not exist any more.');
    const r = polls.vote(poll.id, interaction.user.id, Number(rawIndex));
    if (r.changed === 'closed') return tell(interaction, 'This poll has ended.');
    if (r.changed === 'invalid') return tell(interaction, 'That option does not exist.');
    return interaction.update(pollPayload(poll, polls.results(poll.id)));
}

// Ends a poll (only the first caller succeeds) and updates its message. Returns the ended poll or null.
async function endPoll(client, guildId, number) {
    const { polls } = client.services;
    const poll = polls.end(guildId, number);
    if (!poll) return null;
    try {
        const guild = client.guilds.cache.get(guildId); const channel = await guild?.channels.fetch(poll.channelId).catch(() => null);
        const message = poll.messageId ? await channel?.messages.fetch(poll.messageId).catch(() => null) : null;
        const results = polls.results(poll.id); const final = { ...poll, status: 'ended' };
        if (message) await message.edit(pollPayload(final, results));
        const best = Math.max(0, ...results.rows.map((r) => r.count));
        const winners = best ? results.rows.filter((r) => r.count === best).map((r) => poll.options[r.index]) : [];
        const text = best ? `📊 Poll **#${poll.number}** ended: **${poll.question}**\n🏆 ${winners.length > 1 ? 'Tie: ' : 'Winner: '}**${winners.join('**, **')}** (${best} vote${best === 1 ? '' : 's'})` : `📊 Poll **#${poll.number}** ended: **${poll.question}**\nNobody voted.`;
        await (message ? message.reply({ content: text, allowedMentions: NOBODY }) : channel?.send({ content: text, allowedMentions: NOBODY })).catch(() => {});
    } catch (error) { logger.warn(`Could not update ended poll ${poll.number}: ${error.message}`); }
    return poll;
}

// ===================== reminders + poll timer =====================
async function deliverReminder(client, r, now) {
    if (!client.services.reminders.claim(r.id)) return; // someone else already delivered it
    const late = now - r.dueAt > 2 * 60 * 1000;
    const content = `⏰ <@${r.userId}> reminder${late ? ' (a bit late, I was offline)' : ''}: ${r.text}`;
    const payload = { content, allowedMentions: { users: [r.userId] } };
    const guild = client.guilds.cache.get(r.guildId);
    const channel = await guild?.channels.fetch(r.channelId).catch(() => null);
    const sent = channel ? await channel.send(payload).catch(() => null) : null;
    if (!sent) { const user = await client.users.fetch(r.userId).catch(() => null); await user?.send({ content: `⏰ Reminder from **${guild?.name ?? 'a server'}**: ${r.text}` }).catch(() => {}); }
}
async function utilityTick(client, now = Date.now()) {
    const { reminders, polls } = client.services;
    for (const r of reminders.due(now)) { try { await deliverReminder(client, r, now); } catch (error) { logger.warn(`Reminder ${r.id} failed: ${error.message}`); } }
    for (const p of polls.due(now)) { try { await endPoll(client, p.guildId, p.number); } catch (error) { logger.warn(`Poll ${p.number} end failed: ${error.message}`); } }
}
function startUtilityScheduler(client) {
    let running = false;
    const run = async () => { if (running) return; running = true; try { await utilityTick(client); } catch (error) { logger.error('Utility check failed:', error); } finally { running = false; } };
    run();
    return setInterval(run, 15 * 1000);
}

// ===================== suggestions =====================
function suggestionPayload(s, counts, author = null) {
    const st = SUGGESTION_STATUS[s.status];
    const embed = new EmbedBuilder().setColor(st.color).setTitle(`Suggestion #${s.number}`).setDescription(s.content)
        .addFields({ name: 'Status', value: `${st.emoji} ${st.label}${s.handledBy ? ` by <@${s.handledBy}>` : ''}` });
    if (s.note) embed.addFields({ name: 'Staff note', value: s.note.slice(0, 1000) });
    embed.setAuthor({ name: author?.displayName ?? author?.username ?? 'Member', iconURL: author?.displayAvatarURL?.({ size: 64 }) }).setFooter({ text: `By ${author?.username ?? 'a member'} · ID ${s.authorId}` });
    const components = ['approved', 'denied'].includes(s.status) ? [] : [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sg:up:${s.id}`).setLabel(String(counts.up)).setEmoji('👍').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`sg:down:${s.id}`).setLabel(String(counts.down)).setEmoji('👎').setStyle(ButtonStyle.Danger))];
    return { embeds: [embed], components, allowedMentions: NOBODY };
}
async function handleSuggestionButton(interaction) {
    const [, action, rawId] = interaction.customId.split(':');
    const { suggestions } = interaction.client.services;
    const id = Number(rawId);
    const r = suggestions.vote(id, interaction.user.id, action === 'up' ? 1 : -1);
    if (r === 'closed') return tell(interaction, 'Voting on this suggestion is closed.');
    const s = suggestions.getById(id);
    if (!s || s.guildId !== interaction.guildId) return tell(interaction, 'This suggestion does not exist any more.');
    const author = await interaction.client.users.fetch(s.authorId).catch(() => null);
    return interaction.update(suggestionPayload(s, suggestions.counts(s.id), author));
}

// ===================== starboard =====================
const locks = new Map(); // one reaction at a time per message, so two quick stars cannot post twice
function starPayload(message, stars, emoji) {
    const embed = new EmbedBuilder().setColor(0xf1c40f).setAuthor({ name: message.member?.displayName ?? message.author?.username ?? 'Unknown', iconURL: message.author?.displayAvatarURL?.({ size: 64 }) })
        .setDescription(`${(message.content ?? '').slice(0, 3500) || '*(no text)*'}\n\n[Jump to message](${message.url})`).setTimestamp(message.createdTimestamp ?? Date.now());
    const image = message.attachments?.find?.((a) => /^image\//.test(a.contentType ?? '') || /\.(png|jpe?g|gif|webp)$/i.test(a.name ?? ''));
    if (image) embed.setImage(image.url);
    const shown = /^\d+$/.test(emoji) || /^<a?:/.test(emoji) ? '⭐' : emoji;
    return { content: `${shown} **${stars}** · <#${message.channelId}>`, embeds: [embed], allowedMentions: NOBODY };
}
async function countStars(reaction, message) {
    const users = await reaction.users.fetch({ limit: 100 }).catch(() => null);
    if (!users) return Math.max(0, reaction.count ?? 0);
    return users.filter((u) => !u.bot && u.id !== message.author?.id).size; // self-stars and bots do not count
}
async function handleStarReaction(reaction, client) {
    if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
    if (!reaction) return;
    let message = reaction.message; if (message.partial) message = await message.fetch().catch(() => null);
    if (!message?.guild) return;
    const { starboard } = client.services;
    const config = starboard.getConfig(message.guild.id);
    if (!config.channelId || !emojiMatches(config.emoji, reaction.emoji) || message.channelId === config.channelId) return;
    const key = `${message.guild.id}:${message.id}`;
    const previous = locks.get(key) ?? Promise.resolve();
    const job = previous.then(async () => {
        if (message.channel?.nsfw) return; // never copy age-restricted messages into a normal channel
        const stars = await countStars(reaction, message);
        const existing = starboard.getPost(message.guild.id, message.id);
        const action = starAction(stars, config.threshold, existing);
        if (action === 'none') return;
        const starChannel = await message.guild.channels.fetch(config.channelId).catch(() => null);
        if (!starChannel) return;
        if (action === 'remove') {
            await starChannel.messages.delete(existing.starMessageId).catch(() => {});
            starboard.deletePost(message.guild.id, message.id); return;
        }
        const payload = starPayload(message, stars, config.emoji);
        if (action === 'update') {
            const m = await starChannel.messages.fetch(existing.starMessageId).catch(() => null);
            if (m) { await m.edit(payload); starboard.savePost(message.guild.id, { ...existing, stars }); return; }
        }
        const sent = await starChannel.send(payload);
        starboard.savePost(message.guild.id, { sourceMessageId: message.id, sourceChannelId: message.channelId, starChannelId: starChannel.id, starMessageId: sent.id, stars });
    }).catch((error) => logger.warn(`Starboard error: ${error.message}`)).finally(() => { if (locks.get(key) === job) locks.delete(key); });
    locks.set(key, job);
    return job;
}

module.exports = {
    pollPayload, handlePollButton, endPoll, utilityTick, startUtilityScheduler, deliverReminder,
    suggestionPayload, handleSuggestionButton, starPayload, handleStarReaction, countStars, tell, PRIVATE,
};
