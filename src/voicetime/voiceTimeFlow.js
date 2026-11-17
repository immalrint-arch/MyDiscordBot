// Time spent in voice channels: /voicetime and the once-a-minute counter.
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const { periodRange, dayNumber } = require('../leveling/xpMath');
const { respond, ensureModerator } = require('../moderation/helpers');

const PERIOD_NAMES = { all: 'All time', daily: 'Today', weekly: 'This week', monthly: 'This month' };
const KEEP_DAYS = 62;
const COLOR = 0x5865f2;

function formatMinutes(total) {
    const m = Math.max(0, Math.floor(total)); if (m < 1) return '0m';
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), r = m % 60;
    return [d && `${d}d`, (h || d) && `${h}h`, !d && `${r}m`].filter(Boolean).join(' ');
}

// Called every minute. Counts people sitting in a voice channel (not bots, not deafened, not in the AFK channel).
function voiceTimeTick(client, nowMs = Date.now()) {
    const { voiceTime } = client.services; const day = dayNumber(nowMs);
    for (const guildId of voiceTime.enabledGuilds()) {
        const guild = client.guilds.cache.get(guildId); if (!guild) continue;
        const ids = [];
        for (const channel of guild.channels.cache.values()) {
            if (!channel.isVoiceBased?.() || channel.id === guild.afkChannelId) continue;
            for (const m of channel.members.values()) if (!m.user.bot && !m.voice.selfDeaf && !m.voice.serverDeaf) ids.push(m.id);
        }
        try { voiceTime.addMinute(guildId, ids, day); } catch (e) { logger.warn(`Voice time failed in ${guildId}: ${e.message}`); }
    }
}
function startVoiceTimeScheduler(client) {
    const run = () => { try { voiceTimeTick(client); } catch (e) { logger.warn(`Voice time tick failed: ${e.message}`); } };
    try { client.services.voiceTime.purgeOldDaily(dayNumber(Date.now()) - KEEP_DAYS); } catch { /* not important */ }
    return setInterval(run, 60 * 1000);
}

async function handleVoiceTimeCommand(interaction, { nowMs = Date.now() } = {}) {
    const { voiceTime } = interaction.client.services; const o = interaction.options; const g = interaction.guildId; const sub = o.getSubcommand();
    if (['enable', 'disable', 'reset'].includes(sub) && !(await ensureModerator(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    if (sub === 'enable') { voiceTime.setEnabled(g, true); return respond(interaction, '✅ Voice time tracking is **on**. I count the minutes people spend in voice channels (not while deafened, not in the AFK channel, never bots).'); }
    if (sub === 'disable') { voiceTime.setEnabled(g, false); return respond(interaction, '✅ Voice time tracking is **off**. Saved numbers are kept.'); }
    if (sub === 'reset') { const u = o.getUser('user', true); return respond(interaction, voiceTime.resetUser(g, u.id) ? `🗑️ Erased the voice time of <@${u.id}>.` : `<@${u.id}> had no voice time.`); }
    if (!voiceTime.isEnabled(g) && !voiceTime.countPeople(g)) return respond(interaction, 'Voice time tracking is off. A staff member can turn it on with `/voicetime enable`.');
    if (sub === 'top') {
        const period = o.getString('period') ?? 'all'; const prev = period !== 'all' && o.getBoolean('previous') ? -1 : 0;
        const range = period === 'all' ? {} : periodRange(period, nowMs, prev); const top = voiceTime.top(g, { ...range, limit: 10 });
        const title = `🎙️ Voice time · ${PERIOD_NAMES[period]}${prev ? ' (previous)' : ''}`;
        if (!top.length) return respond(interaction, `${title}\nNobody has spent time in voice yet.`);
        const medal = ['🥇', '🥈', '🥉'];
        return respond(interaction, '', { embeds: [new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(top.map((t, i) => `${medal[i] ?? `**${i + 1}.**`} <@${t.userId}> · **${formatMinutes(t.minutes)}**`).join('\n'))] });
    }
    const user = o.getUser('user') ?? interaction.user; const total = voiceTime.total(g, user.id);
    if (!total) return respond(interaction, `<@${user.id}> has no voice time yet.`);
    const range = (p) => periodRange(p, nowMs, 0); const rank = voiceTime.rank(g, user.id);
    const part = (p) => formatMinutes(voiceTime.between(g, user.id, range(p).startDay, range(p).endDay));
    return respond(interaction, '', { embeds: [new EmbedBuilder().setColor(COLOR).setTitle('🎙️ Voice time').setDescription(`<@${user.id}>`).addFields(
        { name: 'All time', value: formatMinutes(total), inline: true }, { name: 'Rank', value: rank ? `#${rank}` : '-', inline: true }, { name: '​', value: '​', inline: true },
        { name: 'Today', value: part('daily'), inline: true }, { name: 'This week', value: part('weekly'), inline: true }, { name: 'This month', value: part('monthly'), inline: true })] });
}

module.exports = { formatMinutes, voiceTimeTick, startVoiceTimeScheduler, handleVoiceTimeCommand };
