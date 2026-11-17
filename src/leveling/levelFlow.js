const { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const { roleProblem } = require('../roles/roleRules');
const { fetchAvatar } = require('../quotes/quoteFlow');
const { renderLevelUp, renderLeaderboard, renderRank, isLevelImageAvailable } = require('./levelImages');
const { renderLevelMessage, planLevelRoles } = require('./levelTemplate');
const { periodRange, periodKey, PERIOD_TITLES, progress, totalXpForLevel } = require('./xpMath');

const PAGE_SIZE = 10;
const avatarUrl = (userLike) => userLike.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true });

// ---------- level roles ----------
// Gives/takes the reward roles a member should have at `level`. Returns the newest role they got (or null).
async function applyLevelRoles(member, level, client) {
    const { levels } = client.services;
    const guild = member.guild;
    const rewards = levels.listLevelRoles(guild.id);
    if (!rewards.length) return null;
    const config = levels.getConfig(guild.id);
    const plan = planLevelRoles(rewards, level, config.rewardMode);
    const me = guild.members.me ?? await guild.members.fetchMe();
    const check = (id, dangerous) => roleProblem({ role: guild.roles.cache.get(id), guildId: guild.id, botHighestPosition: me.roles.highest.position, forbidDangerous: dangerous });

    const add = [];
    for (const id of plan.keep) {
        if (member.roles.cache.has(id)) continue;
        const problem = check(id, true);
        if (problem) logger.warn(`Level role ${id} skipped in server ${guild.id}: ${problem}`);
        else add.push(id);
    }
    const remove = plan.drop.filter((id) => member.roles.cache.has(id) && !check(id, false));
    try {
        if (remove.length) await member.roles.remove(remove, 'Level roles');
        if (add.length) await member.roles.add(add, `Reached level ${level}`);
    } catch (error) {
        logger.warn(`Could not change level roles in server ${guild.id}: ${error.message}`);
        return null;
    }
    if (!add.length) return null;
    return rewards.filter((r) => add.includes(r.roleId)).sort((a, b) => b.level - a.level)[0].roleId;
}

// ---------- level-up message ----------
async function buildLevelUpPayload({ config, member, result, rank, roleId, guild, fetchImpl }) {
    const text = renderLevelMessage(config.levelupMessage, {
        userId: member.id, username: member.user.username, displayname: member.displayName ?? member.user.username,
        level: result.level, oldLevel: result.oldLevel, xp: result.xp, rank, server: guild.name, roleId,
    }).slice(0, 2000);
    const allowedMentions = config.levelupPing ? { parse: [], users: [member.id] } : { parse: [] };

    let style = config.announceStyle;
    if (style === 'card' && !isLevelImageAvailable()) style = 'embed';
    if (style === 'text') return { content: text, allowedMentions };
    if (style === 'embed') {
        const embed = new EmbedBuilder().setColor(0x2b2d31).setDescription(text).setFooter({ text: `Level ${result.oldLevel} • ${result.level}` })
            .setThumbnail(avatarUrl(member.user));
        return { embeds: [embed], allowedMentions };
    }
    const png = await renderLevelUp({ avatarBuffer: await fetchAvatar(avatarUrl(member.user), { fetchImpl }), from: result.oldLevel, to: result.level });
    return { content: text, files: [new AttachmentBuilder(png, { name: 'levelup.png', description: `Level ${result.level}` })], allowedMentions };
}

async function announceLevelUp(member, result, { channel = null, roleId = null, force = false, fetchImpl } = {}) {
    const client = member.client;
    const { levels } = client.services;
    const guild = member.guild;
    const config = levels.getConfig(guild.id);
    if (!force && config.announceMode === 'off') return null;
    const payload = await buildLevelUpPayload({ config, member, result, rank: levels.getRank(guild.id, member.id), roleId, guild, fetchImpl });

    if (!force && config.announceMode === 'dm') return member.user.send(payload).catch(() => null);
    let target = force ? channel : (config.announceMode === 'channel' ? guild.channels.cache.get(config.announceChannelId) ?? channel : channel);
    if (!target?.isTextBased()) return null;
    const me = guild.members.me;
    const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
    if (payload.files) needed.push(PermissionFlagsBits.AttachFiles);
    if (payload.embeds) needed.push(PermissionFlagsBits.EmbedLinks);
    if (!me || !target.permissionsFor(me)?.has(needed)) return null;
    return target.send(payload).catch((error) => { logger.warn(`Could not send a level-up message in server ${guild.id}: ${error.message}`); return null; });
}

async function onLevelUp(member, result, { channel = null } = {}) {
    const client = member.client;
    const roleId = await applyLevelRoles(member, result.level, client);
    await announceLevelUp(member, result, { channel, roleId });
}

// ---------- messages ----------
async function handleMessage(message) {
    if (!message.inGuild() || message.author.bot || message.webhookId || message.system || !message.member) return;
    const { levels } = message.client.services;
    const result = levels.awardMessage({
        guildId: message.guild.id, userId: message.author.id, channelId: message.channelId,
        roleIds: [...message.member.roles.cache.keys()], contentLength: (message.content ?? '').trim().length,
    });
    if (result?.leveledUp) await onLevelUp(message.member, result, { channel: message.channel });
}

// ---------- leaderboard ----------
async function resolveUser(client, guild, userId) {
    return guild.members.cache.get(userId)?.user ?? await client.users.fetch(userId).catch(() => null);
}

// period: 'all' | 'daily' | 'weekly' | 'monthly'. offset: 0 = this period so far, -1 = the previous one.
async function buildLeaderboardPayload(client, guild, { period = 'all', page = 1, offset = 0, nowMs = Date.now(), fetchImpl } = {}) {
    const { levels } = client.services;
    let rows; let total;
    if (period === 'all') {
        total = levels.countRanked(guild.id);
    } else {
        const range = periodRange(period, nowMs, offset);
        total = levels.countPeriod(guild.id, range.startDay, range.endDay);
        rows = (opts) => levels.topPeriod(guild.id, range.startDay, range.endDay, opts);
    }
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(Math.max(1, page), pages);
    const opts = { limit: PAGE_SIZE, offset: (current - 1) * PAGE_SIZE };
    const list = period === 'all' ? levels.top(guild.id, opts) : rows(opts);

    const shown = [];
    for (let i = 0; i < list.length; i++) {
        const user = await resolveUser(client, guild, list[i].userId);
        shown.push({
            rank: opts.offset + i + 1,
            name: user?.username ?? 'unknown-user',
            avatarBuffer: user ? await fetchAvatar(avatarUrl(user), { fetchImpl }) : null,
            levelText: period === 'all' ? `LVL: ${list[i].level}` : `LVL: +${list[i].levels}`,
            xpText: period === 'all' ? `XP: ${list[i].xp.toLocaleString('en-US')}` : `XP: +${list[i].xp.toLocaleString('en-US')}`,
            userId: list[i].userId,
        });
    }
    const title = PERIOD_TITLES[period];
    const content = pages > 1 ? `Page ${current} of ${pages}` : undefined;
    const allowedMentions = { parse: [] };
    if (!shown.length || !isLevelImageAvailable()) {
        const text = shown.length ? shown.map((r) => `**#${r.rank}** <@${r.userId}> • ${r.levelText} ${r.xpText}`).join('\n') : 'Nobody has earned XP yet.';
        return { content, embeds: [new EmbedBuilder().setColor(0x2b2d31).setTitle(title).setDescription(text)], allowedMentions, empty: !shown.length, pages, page: current };
    }
    const png = await renderLeaderboard({ title, rows: shown });
    return { content, files: [new AttachmentBuilder(png, { name: 'leaderboard.png', description: title })], allowedMentions, empty: false, pages, page: current };
}

async function buildRankPayload(client, guild, user, { fetchImpl } = {}) {
    const { levels } = client.services;
    const data = levels.getUser(guild.id, user.id);
    const p = progress(data.xp);
    const rank = levels.getRank(guild.id, user.id);
    const member = guild.members.cache.get(user.id);
    const name = member?.displayName ?? user.globalName ?? user.username;
    if (!isLevelImageAvailable()) {
        const embed = new EmbedBuilder().setColor(0x2b2d31).setAuthor({ name, iconURL: avatarUrl(user) })
            .setDescription(`**Level ${p.level}** • ${rank ? `Rank #${rank}` : 'Unranked'}\n${p.current.toLocaleString('en-US')} / ${p.needed.toLocaleString('en-US')} XP (${p.percent}%)\nTotal: ${data.xp.toLocaleString('en-US')} XP`);
        return { embeds: [embed], allowedMentions: { parse: [] } };
    }
    const png = await renderRank({ name, avatarBuffer: await fetchAvatar(avatarUrl(user), { fetchImpl }), rank, level: p.level, current: p.current, needed: p.needed, percent: p.percent, totalXp: data.xp });
    return { files: [new AttachmentBuilder(png, { name: 'rank.png', description: `Rank of ${name}` })], allowedMentions: { parse: [] } };
}

// ---------- schedulers ----------
async function voiceTick(client) {
    const { levels } = client.services;
    for (const guildId of levels.guildsWithVoiceXp()) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;
        for (const channel of guild.channels.cache.values()) {
            if (!channel.isVoiceBased?.() || channel.id === guild.afkChannelId) continue;
            const people = [...channel.members.values()].filter((m) => !m.user.bot);
            if (people.length < 2) continue; // talking to nobody does not count
            for (const member of people) {
                if (member.voice.selfDeaf || member.voice.serverDeaf) continue;
                const result = levels.awardVoice({ guildId, userId: member.id, roleIds: [...member.roles.cache.keys()], channelId: channel.id });
                if (result?.leveledUp) await onLevelUp(member, result, { channel: null }).catch((e) => logger.warn(`Voice level-up failed: ${e.message}`));
            }
        }
    }
}

async function highlightsTick(client, nowMs = Date.now()) {
    const { levels } = client.services;
    for (const guildId of levels.guildsWithHighlights()) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;
        const config = levels.getConfig(guildId);
        const key = periodKey(config.highlightsPeriod, nowMs);
        if (config.highlightsLast === 0) { levels.setConfig(guildId, { highlightsLast: key }); continue; } // first run: wait for the next period
        if (config.highlightsLast === key) continue;
        const channel = guild.channels.cache.get(config.highlightsChannelId);
        const me = guild.members.me;
        try {
            if (channel?.isTextBased() && me && channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles])) {
                const payload = await buildLeaderboardPayload(client, guild, { period: config.highlightsPeriod, offset: -1, nowMs });
                if (!payload.empty) await channel.send(payload);
            }
        } catch (error) {
            logger.warn(`Could not post XP highlights in server ${guildId}: ${error.message}`);
        }
        levels.setConfig(guildId, { highlightsLast: key }); // mark as done even on failure so we never spam
    }
}

function startLevelSchedulers(client) {
    const safe = (fn, name) => () => fn(client).catch((e) => logger.warn(`${name} failed: ${e.message}`));
    const timers = [setInterval(safe(voiceTick, 'Voice XP'), 60 * 1000), setInterval(safe(highlightsTick, 'XP highlights'), 10 * 60 * 1000)];
    safe(highlightsTick, 'XP highlights')();
    try { client.services.levels.purgeOldDaily(Math.floor(Date.now() / 86400000) - 400); } catch { /* not important */ }
    return timers;
}

module.exports = {
    applyLevelRoles, announceLevelUp, onLevelUp, handleMessage, buildLeaderboardPayload, buildRankPayload,
    voiceTick, highlightsTick, startLevelSchedulers, PAGE_SIZE, totalXpForLevel,
};
