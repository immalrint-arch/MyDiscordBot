// Question of the day: a daily question with a thread for answers.
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const { respond, ensureModerator } = require('../moderation/helpers');
const { parseTime, formatTime, cleanQuestion, isDue, threadName } = require('./rules');

const PERM = PermissionFlagsBits.ManageGuild;
const COLOR = 0x5865f2;

function questionEmbed(n, text, cfg) {
    return new EmbedBuilder().setColor(COLOR).setTitle(`❓ Question of the Day #${n}`).setDescription(text)
        .setFooter({ text: cfg.useThreads ? 'Share your answer in the thread below 👇' : 'Share your answer below 👇' });
}

// Picks a question and posts it. Returns { ok, text, error }.
async function postQuestion(client, guildId) {
    const { qotd } = client.services; const cfg = qotd.getConfig(guildId);
    const guild = client.guilds.cache.get(guildId); if (!guild) return { ok: false, error: 'I am not in that server.' };
    const channel = cfg.channelId ? (guild.channels.cache.get(cfg.channelId) ?? await guild.channels.fetch(cfg.channelId).catch(() => null)) : null;
    if (!channel?.send) return { ok: false, error: 'I cannot find the question channel. Run `/qotd setup` again.' };
    let picked; try { picked = qotd.pickQuestion(guildId); } catch (e) { return { ok: false, error: e.message }; }
    const n = qotd.nextNumber(guildId);
    try {
        const message = await channel.send({ content: cfg.roleId ? `<@&${cfg.roleId}>` : undefined, embeds: [questionEmbed(n, picked.text, cfg)], allowedMentions: cfg.roleId ? { roles: [cfg.roleId] } : { parse: [] } });
        if (cfg.useThreads && message?.startThread) await message.startThread({ name: threadName(n, picked.text), autoArchiveDuration: 1440, reason: 'Question of the day' }).catch((e) => logger.warn(`QOTD thread failed in ${guildId}: ${e.message}`));
        return { ok: true, text: picked.text, number: n };
    } catch (error) { logger.warn(`QOTD post failed in ${guildId}: ${error.message}`); return { ok: false, error: 'I could not post in that channel (check my permissions).' }; }
}

async function qotdTick(client, nowMs = Date.now()) {
    const { qotd } = client.services;
    for (const cfg of qotd.enabledGuilds()) {
        if (!isDue(cfg, cfg.lastDay, nowMs)) continue;
        if (!qotd.claimDay(cfg.guildId, nowMs)) continue; // someone else already did today
        const r = await postQuestion(client, cfg.guildId); if (!r.ok) logger.warn(`QOTD not posted in ${cfg.guildId}: ${r.error}`);
    }
}
function startQotdScheduler(client) { return setInterval(() => { qotdTick(client).catch((e) => logger.warn(`QOTD scheduler failed: ${e.message}`)); }, 30 * 1000); }

async function handleQotdCommand(interaction) {
    const { qotd } = interaction.client.services; const o = interaction.options; const g = interaction.guildId; const sub = o.getSubcommand();
    if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
    if (sub === 'setup') {
        const channel = o.getChannel('channel', true); const timeText = o.getString('time'); const t = timeText ? parseTime(timeText) : null;
        if (timeText && !t) return respond(interaction, 'Write the time like `09:00` or `21:30` (24-hour clock).', { ephemeral: true });
        let cfg; try { cfg = qotd.configure(g, { enabled: true, channelId: channel.id, roleId: o.getRole('role')?.id, hour: t?.hour, minute: t?.minute, utcOffset: o.getInteger('utc_offset') ?? undefined, useThreads: o.getBoolean('threads') ?? undefined, useBuiltin: o.getBoolean('builtin') ?? undefined }); }
        catch (e) { return respond(interaction, e.message, { ephemeral: true }); }
        const dueToday = isDue(cfg, cfg.lastDay, Date.now()); if (dueToday) qotd.claimDay(g); // do not post right away just because setup ran after the time
        return respond(interaction, `✅ A question will be posted in <#${channel.id}> every day at **${formatTime(cfg.hour, cfg.minute)}** (UTC${cfg.utcOffset >= 0 ? '+' : ''}${cfg.utcOffset}). ${dueToday ? 'The first one is tomorrow. ' : ''}Use \`/qotd post\` to post one now.`);
    }
    if (sub === 'enable' || sub === 'disable') { try { qotd.configure(g, { enabled: sub === 'enable' }); } catch (e) { return respond(interaction, e.message, { ephemeral: true }); } return respond(interaction, sub === 'enable' ? '✅ Daily questions are **on**.' : '✅ Daily questions are **off**.'); }
    if (sub === 'add') {
        const c = cleanQuestion(o.getString('question', true)); if (!c.ok) return respond(interaction, c.error, { ephemeral: true });
        try { const id = qotd.addQuestion(g, c.text, interaction.user.id); return respond(interaction, `✅ Added question **#${id}**. You have ${qotd.countQuestions(g)} of your own.`); } catch (e) { return respond(interaction, e.message, { ephemeral: true }); }
    }
    if (sub === 'remove') return respond(interaction, qotd.removeQuestion(g, o.getInteger('id', true)) ? '✅ Question removed.' : 'I could not find a question with that number. See `/qotd list`.');
    if (sub === 'list') {
        const page = Math.max(1, o.getInteger('page') ?? 1); const total = qotd.countQuestions(g); const pages = Math.max(1, Math.ceil(total / 10));
        const rows = qotd.listQuestions(g, { limit: 10, offset: (page - 1) * 10 });
        if (!rows.length) return respond(interaction, total ? `There are only ${pages} page(s).` : 'You have no questions of your own yet. Add one with `/qotd add`. The built-in ones are used meanwhile.');
        return respond(interaction, [`**Your questions** (page ${page}/${pages}, ${total} total)`, ...rows.map((q) => `**#${q.id}** ${q.text.slice(0, 150)}${q.usedCount ? ` _(asked ${q.usedCount}×)_` : ''}`)].join('\n'));
    }
    if (sub === 'post') {
        if (!qotd.getConfig(g).channelId) return respond(interaction, 'Run `/qotd setup` first.', { ephemeral: true });
        await interaction.deferReply?.(); const r = await postQuestion(interaction.client, g);
        return respond(interaction, r.ok ? `✅ Posted question #${r.number}.` : r.error);
    }
    if (sub === 'status') {
        const c = qotd.getConfig(g); const mine = qotd.countQuestions(g);
        return respond(interaction, [`**Question of the day:** ${c.enabled ? 'on' : 'off'}`, `Channel: ${c.channelId ? `<#${c.channelId}>` : 'not set'} · Time: ${formatTime(c.hour, c.minute)} (UTC${c.utcOffset >= 0 ? '+' : ''}${c.utcOffset})`,
            `Ping role: ${c.roleId ? `<@&${c.roleId}>` : 'none'} · Threads: ${c.useThreads ? 'yes' : 'no'} · Built-in questions: ${c.useBuiltin ? 'yes' : 'no'}`, `Your own questions: ${mine} · Posted so far: ${c.counter}`].join('\n'));
    }
}

module.exports = { handleQotdCommand, postQuestion, qotdTick, startQotdScheduler, questionEmbed };
