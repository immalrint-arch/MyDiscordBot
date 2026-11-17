const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const { pickWinners, entryProblem, unix } = require('./giveawayRules');

const COLOR = 0x5865f2;
const ENDED_COLOR = 0x2b2d31;
const REMIND_BEFORE_MS = 15 * 60 * 1000;
const lastEdit = new Map(); // throttle: giveaway id -> time of last live edit
const noMentions = { parse: [] };
const private_ = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: noMentions });

// ======================= giveaways =======================
function requirementLines(g) {
    const lines = [];
    if (g.requiredRoleId) lines.push(`• Role: <@&${g.requiredRoleId}>`);
    if (g.minLevel) lines.push(`• Level ${g.minLevel}+`);
    if (g.minDays) lines.push(`• In the server ${g.minDays}+ day(s)`);
    if (g.bypassRoleId) lines.push(`• <@&${g.bypassRoleId}> skips these rules`);
    return lines;
}

function giveawayPayload(g, entryCount, { winnerIds = null } = {}) {
    const ended = g.status !== 'active';
    const lines = [];
    if (g.description) lines.push(g.description, '');
    if (g.status === 'cancelled') lines.push('🚫 **This giveaway was cancelled.**');
    else if (ended) lines.push(winnerIds?.length ? `🏆 **Winner${winnerIds.length > 1 ? 's' : ''}:** ${winnerIds.map((id) => `<@${id}>`).join(' ')}` : '😔 **No valid entries, so nobody won.**');
    else lines.push(`⏰ Ends: <t:${unix(g.endsAt)}:R> (<t:${unix(g.endsAt)}:f>)`);
    lines.push(`🎙️ Hosted by: <@${g.hostId}>`, `🎁 Winners: **${g.winners}**`);
    const req = requirementLines(g);
    if (req.length && !ended) lines.push('', '**To enter you need:**', ...req);
    const embed = new EmbedBuilder().setColor(ended ? ENDED_COLOR : COLOR).setTitle(`🎉 ${g.prize}`).setDescription(lines.join('\n').slice(0, 4000))
        .setFooter({ text: `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} • ID ${g.id}${ended ? ' • ended' : ''}` });
    if (ended) embed.setTimestamp(g.endedAt ?? Date.now());
    const button = new ButtonBuilder().setCustomId(`gw:enter:${g.id}`).setLabel(ended ? 'Giveaway ended' : 'Enter').setEmoji('🎉').setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(ended);
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)], allowedMentions: noMentions };
}

async function fetchGiveawayMessage(client, g) {
    const channel = client.channels.cache.get(g.channelId) ?? await client.channels.fetch(g.channelId).catch(() => null);
    return channel?.messages?.fetch(g.messageId).catch(() => null) ?? null;
}

async function refreshGiveaway(client, g, extra = {}) {
    const { giveaways } = client.services.giveaways;
    const message = g.messageId ? await fetchGiveawayMessage(client, g) : null;
    if (message) await message.edit(giveawayPayload(g, giveaways.countEntries(g.id), extra)).catch((e) => logger.warn(`Could not update giveaway ${g.id}: ${e.message}`));
    return message;
}

// Posts a new giveaway in its channel.
async function publishGiveaway(client, g, channel) {
    const { giveaways } = client.services.giveaways;
    const pingRole = g.pingRoleId;
    const message = await channel.send({
        ...giveawayPayload(g, 0),
        ...(pingRole ? { content: `<@&${pingRole}> 🎉 A new giveaway!` } : {}),
        allowedMentions: pingRole ? { parse: [], roles: [pingRole] } : noMentions,
    });
    giveaways.setMessage(g.id, message.id);
    return message;
}

async function personOf(client, guild, userId) {
    const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    if (!member) return null;
    return { member, roleIds: [...member.roles.cache.keys()], level: client.services.levels?.getUser(guild.id, userId).level ?? 0, joinedAt: member.joinedTimestamp ?? null };
}

// Button: gw:enter:<id>. Clicking again leaves the giveaway.
async function handleGiveawayButton(interaction) {
    const [, action, idText] = interaction.customId.split(':');
    if (action !== 'enter') return;
    const { giveaways } = interaction.client.services.giveaways;
    const g = giveaways.getForGuild(interaction.guildId, Number(idText));
    if (!g || g.status !== 'active') return private_(interaction, 'This giveaway is over.');
    if (g.endsAt <= Date.now()) return private_(interaction, 'This giveaway is just ending. Winners are being picked.');
    if (giveaways.hasEntry(g.id, interaction.user.id)) {
        giveaways.removeEntry(g.id, interaction.user.id);
        await throttledRefresh(interaction.client, g);
        return private_(interaction, '👋 You left the giveaway. Click **Enter** again to rejoin.');
    }
    const person = { roleIds: [...(interaction.member?.roles?.cache?.keys?.() ?? [])], level: interaction.client.services.levels?.getUser(interaction.guildId, interaction.user.id).level ?? 0, joinedAt: interaction.member?.joinedTimestamp ?? null };
    const problem = entryProblem(g, person);
    if (problem) return private_(interaction, `⚠️ ${problem}`);
    giveaways.addEntry(g.id, interaction.user.id);
    await throttledRefresh(interaction.client, g);
    return private_(interaction, `✅ You are in! Good luck. (${giveaways.countEntries(g.id)} entries so far.)`);
}

async function throttledRefresh(client, g) {
    const last = lastEdit.get(g.id) ?? 0;
    if (Date.now() - last < 4000) return; // the scheduler will catch up
    lastEdit.set(g.id, Date.now());
    await refreshGiveaway(client, g);
}

// Ends a giveaway: picks winners among entrants who STILL qualify. Safe to call twice (only the first one acts).
async function endGiveaway(client, id, { ignoreTime = true } = {}) {
    const { giveaways } = client.services.giveaways;
    const g = giveaways.get(id);
    if (!g || g.status !== 'active') return null;
    if (!ignoreTime && g.endsAt > Date.now()) return null;
    if (!giveaways.markEnded(id)) return null;
    const ended = giveaways.get(id);
    const guild = client.guilds.cache.get(g.guildId);
    const winnerIds = guild ? await chooseWinners(client, guild, ended, giveaways.entries(id), ended.winners) : [];
    giveaways.setWinners(id, winnerIds);
    await announceResult(client, guild, giveaways.get(id), winnerIds, { reroll: false });
    return { giveaway: giveaways.get(id), winnerIds };
}

async function chooseWinners(client, guild, g, entryIds, count, exclude = []) {
    const eligible = [];
    for (const userId of entryIds) {
        if (exclude.includes(userId)) continue;
        const person = await personOf(client, guild, userId);
        if (!person) continue; // left the server
        if (entryProblem(g, person)) continue; // lost the role or no longer qualifies
        eligible.push(userId);
    }
    return pickWinners(eligible, count);
}

async function announceResult(client, guild, g, winnerIds, { reroll }) {
    const channel = client.channels.cache.get(g.channelId) ?? await client.channels.fetch(g.channelId).catch(() => null);
    const shown = winnerIds.length ? g.winnerIds : [];
    await refreshGiveaway(client, g, { winnerIds: reroll ? g.winnerIds : shown });
    if (!channel?.isTextBased()) return;
    const me = guild?.members?.me;
    if (me && !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return;
    const link = g.messageId ? `https://discord.com/channels/${g.guildId}/${g.channelId}/${g.messageId}` : null;
    const content = winnerIds.length
        ? `🎉 ${reroll ? 'New winner' : 'Congratulations'} ${winnerIds.map((id) => `<@${id}>`).join(', ')}! You won **${g.prize}**!${link ? `\n${link}` : ''}`
        : `😔 Nobody could win **${g.prize}**: there were no valid entries.${link ? `\n${link}` : ''}`;
    await channel.send({ content, allowedMentions: { parse: [], users: winnerIds } }).catch((e) => logger.warn(`Could not announce giveaway ${g.id}: ${e.message}`));
}

// New winners from the same entries, never the people who already won.
async function rerollGiveaway(client, id, count = 1) {
    const { giveaways } = client.services.giveaways;
    const g = giveaways.get(id);
    if (!g || g.status !== 'ended') return { error: 'That giveaway has not ended (or does not exist).' };
    const guild = client.guilds.cache.get(g.guildId);
    if (!guild) return { error: 'I cannot see that server right now.' };
    const winnerIds = await chooseWinners(client, guild, g, giveaways.entries(id), count, g.winnerIds);
    if (!winnerIds.length) return { error: 'There is nobody left to pick.' };
    giveaways.setWinners(id, [...g.winnerIds, ...winnerIds]);
    await announceResult(client, guild, giveaways.get(id), winnerIds, { reroll: true });
    return { winnerIds };
}

async function cancelGiveaway(client, id) {
    const { giveaways } = client.services.giveaways;
    if (!giveaways.markCancelled(id)) return false;
    await refreshGiveaway(client, giveaways.get(id));
    return true;
}

// ======================= events =======================
function eventPayload(e, counts, { goingIds = [] } = {}) {
    const over = e.status !== 'scheduled';
    const lines = [];
    if (e.description) lines.push(e.description, '');
    lines.push(`🕒 <t:${unix(e.startsAt)}:F> (<t:${unix(e.startsAt)}:R>)`);
    if (e.location) lines.push(`📍 ${e.location}`);
    lines.push(`🎙️ Hosted by <@${e.hostId}>`);
    if (e.status === 'cancelled') lines.push('', '🚫 **This event was cancelled.**');
    if (e.status === 'started') lines.push('', '▶️ **This event has started!**');
    const embed = new EmbedBuilder().setColor(e.status === 'cancelled' ? 0xed4245 : over ? ENDED_COLOR : 0x57f287).setTitle(`📅 ${e.title}`).setDescription(lines.join('\n').slice(0, 4000))
        .addFields({ name: `✅ Going (${counts.going})`, value: goingIds.length ? goingIds.slice(0, 15).map((id) => `<@${id}>`).join(' ') + (counts.going > 15 ? ` +${counts.going - 15} more` : '') : '—', inline: true }, { name: `🤔 Maybe (${counts.maybe})`, value: String(counts.maybe), inline: true })
        .setFooter({ text: `Event ID ${e.id}` });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ev:going:${e.id}`).setLabel('Going').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(over),
        new ButtonBuilder().setCustomId(`ev:maybe:${e.id}`).setLabel('Maybe').setEmoji('🤔').setStyle(ButtonStyle.Primary).setDisabled(over),
        new ButtonBuilder().setCustomId(`ev:leave:${e.id}`).setLabel('Not going').setStyle(ButtonStyle.Secondary).setDisabled(over),
    );
    return { embeds: [embed], components: [row], allowedMentions: noMentions };
}

async function refreshEvent(client, e) {
    const { events } = client.services.giveaways;
    if (!e.messageId) return;
    const channel = client.channels.cache.get(e.channelId) ?? await client.channels.fetch(e.channelId).catch(() => null);
    const message = await channel?.messages?.fetch(e.messageId).catch(() => null);
    if (message) await message.edit(eventPayload(e, events.counts(e.id), { goingIds: events.rsvps(e.id, 'going').map((r) => r.userId) })).catch((err) => logger.warn(`Could not update event ${e.id}: ${err.message}`));
}

async function publishEvent(client, e, channel) {
    const { events } = client.services.giveaways;
    const message = await channel.send({
        ...eventPayload(e, { going: 0, maybe: 0 }),
        ...(e.pingRoleId ? { content: `<@&${e.pingRoleId}> 📅 New event!` } : {}),
        allowedMentions: e.pingRoleId ? { parse: [], roles: [e.pingRoleId] } : noMentions,
    });
    events.setMessage(e.id, message.id);
    return message;
}

async function handleEventButton(interaction) {
    const [, action, idText] = interaction.customId.split(':');
    const { events } = interaction.client.services.giveaways;
    const e = events.getForGuild(interaction.guildId, Number(idText));
    if (!e || e.status !== 'scheduled') return private_(interaction, 'This event is over.');
    let text;
    if (action === 'leave') { text = events.removeRsvp(e.id, interaction.user.id) ? '👋 Your answer was removed.' : 'You had not answered.'; }
    else if (action === 'going' || action === 'maybe') { events.rsvp(e.id, interaction.user.id, action); text = action === 'going' ? '✅ You are going! I will remind you shortly before it starts.' : '🤔 Marked as maybe. I will remind you before it starts.'; }
    else return;
    await refreshEvent(interaction.client, e);
    return private_(interaction, text);
}

// ======================= scheduler =======================
async function tick(client, nowMs = Date.now()) {
    const { giveaways, events } = client.services.giveaways;
    for (const g of giveaways.due(nowMs)) await endGiveaway(client, g.id).catch((e) => logger.error(`Ending giveaway ${g.id} failed: ${e.message}`));
    for (const e of events.dueReminders(REMIND_BEFORE_MS, nowMs)) {
        if (!events.markReminded(e.id)) continue;
        const channel = client.channels.cache.get(e.channelId);
        const ids = events.rsvps(e.id).map((r) => r.userId).slice(0, 80);
        if (channel?.isTextBased() && ids.length) {
            await channel.send({ content: `⏰ **${e.title}** starts <t:${unix(e.startsAt)}:R>!\n${ids.map((id) => `<@${id}>`).join(' ')}`, allowedMentions: { parse: [], users: ids } }).catch(() => {});
        }
    }
    for (const e of events.dueStarts(nowMs)) {
        if (!events.markStarted(e.id)) continue;
        const fresh = events.get(e.id);
        await refreshEvent(client, fresh);
        const channel = client.channels.cache.get(e.channelId);
        const going = events.rsvps(e.id, 'going').map((r) => r.userId).slice(0, 80);
        if (channel?.isTextBased()) await channel.send({ content: `▶️ **${e.title}** is starting now!${going.length ? `\n${going.map((id) => `<@${id}>`).join(' ')}` : ''}`, allowedMentions: { parse: [], users: going } }).catch(() => {});
    }
}

function startGiveawayScheduler(client) {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await tick(client); } catch (error) { logger.error('Giveaway check failed:', error); } finally { running = false; }
    };
    run();
    return setInterval(run, 15 * 1000);
}

module.exports = {
    giveawayPayload, publishGiveaway, refreshGiveaway, handleGiveawayButton, endGiveaway, rerollGiveaway, cancelGiveaway,
    eventPayload, publishEvent, refreshEvent, handleEventButton, tick, startGiveawayScheduler, REMIND_BEFORE_MS,
};
