// Tools for the person who runs the bot: ownership, backups, blacklist, error alerts, /botinfo.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EmbedBuilder, MessageFlags, version: discordVersion } = require('discord.js');
const logger = require('../utils/logger');
const { formatDuration } = require('../utils/duration');

const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups');
const KEEP_BACKUPS = 7, BACKUP_EVERY_MS = 24 * 3600000;
const ERROR_KEY = 'error_channel';
const COLOR = 0x5865f2;
const PRIVATE = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };

// ---------- who is the owner? ----------
const owners = new Set(); let ownersKnown = false;
function idsFromApplication(app) {
    const o = app?.owner; if (!o) return [];
    if (o.members) return [o.ownerId, ...[...o.members.values()].map((m) => m.user?.id ?? m.id)].filter(Boolean);
    return o.id ? [o.id] : [];
}
async function loadOwners(client, env = process.env) {
    owners.clear();
    for (const id of String(env.OWNER_IDS ?? '').split(/[,\s]+/)) if (/^\d{15,25}$/.test(id)) owners.add(id);
    try { const app = await client.application.fetch(); for (const id of idsFromApplication(app)) owners.add(id); } catch (e) { logger.warn(`Could not look up the bot owner: ${e.message}`); }
    ownersKnown = owners.size > 0; return [...owners];
}
const isOwner = (userId) => owners.has(userId);
const setOwnersForTest = (ids) => { owners.clear(); ids.forEach((i) => owners.add(i)); ownersKnown = ids.length > 0; };

// ---------- backups ----------
const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
function listBackups(dir = BACKUP_DIR) { try { return fs.readdirSync(dir).filter((f) => /^bot-\d{8}-\d{6}\.sqlite$/.test(f)).sort(); } catch { return []; } }
function createBackup(db, { dir = BACKUP_DIR, now = Date.now(), keep = KEEP_BACKUPS } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    let file = path.join(dir, `bot-${stamp(now)}.sqlite`); if (fs.existsSync(file)) return { file, size: fs.statSync(file).size, kept: listBackups(dir).length, existed: true };
    db.prepare('VACUUM INTO ?').run(file); // a clean, consistent copy even while the bot is running
    const all = listBackups(dir); for (const old of all.slice(0, Math.max(0, all.length - keep))) { try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignore */ } }
    return { file, size: fs.statSync(file).size, kept: listBackups(dir).length, existed: false };
}
const lastBackupTime = (dir = BACKUP_DIR) => { const l = listBackups(dir); if (!l.length) return 0; try { return fs.statSync(path.join(dir, l.at(-1))).mtimeMs; } catch { return 0; } };
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

// ---------- error alerts ----------
const recent = new Map(); let sentThisHour = 0, hourStart = 0;
function installErrorAlerts(client, { now = Date.now } = {}) {
    logger.setErrorSink((text) => { alertError(client, text, now()).catch(() => {}); });
}
async function alertError(client, text, t = Date.now()) {
    const channelId = client.services.access.config.get(ERROR_KEY); if (!channelId) return false;
    const key = text.slice(0, 200); if (t - (recent.get(key) ?? 0) < 60000) return false; recent.set(key, t);
    if (recent.size > 200) for (const [k, v] of recent) if (t - v > 60000) recent.delete(k);
    if (t - hourStart > 3600000) { hourStart = t; sentThisHour = 0; } if (sentThisHour >= 20) return false; sentThisHour++;
    try {
        const channel = await client.channels.fetch(channelId); if (!channel?.send) return false;
        await channel.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('⚠️ Bot error').setDescription(`\`\`\`\n${text.replace(/```/g, "'''").slice(0, 1800)}\n\`\`\``).setTimestamp(t)], allowedMentions: { parse: [] } }); return true;
    } catch (e) { logger.warn(`Could not send an error alert: ${e.message}`); return false; }
}

// ---------- /botinfo ----------
function readVersion() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version; } catch { return null; } }
async function handleBotInfo(interaction) {
    const c = interaction.client; const members = [...c.guilds.cache.values()].reduce((n, g) => n + (g.memberCount ?? 0), 0); const v = readVersion();
    const embed = new EmbedBuilder().setColor(COLOR).setTitle(`${c.user.username}${v ? ` v${v}` : ''}`).addFields(
        { name: 'Servers', value: String(c.guilds.cache.size), inline: true }, { name: 'Members', value: members.toLocaleString('en-US'), inline: true }, { name: 'Commands', value: String(c.commands.size), inline: true },
        { name: 'Uptime', value: formatDuration(process.uptime() * 1000) || '0s', inline: true }, { name: 'Ping', value: `${Math.round(c.ws.ping)} ms`, inline: true }, { name: 'Memory', value: mb(process.memoryUsage().rss), inline: true },
        { name: 'Runtime', value: `Node ${process.version} · discord.js ${discordVersion} · ${os.platform()}`, inline: false });
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

// ---------- /owner ----------
async function handleOwnerCommand(interaction) {
    const reply = (content, extra = {}) => (interaction.deferred || interaction.replied ? interaction.editReply({ content, allowedMentions: { parse: [] } }) : interaction.reply({ content, ...PRIVATE, ...extra }));
    if (!ownersKnown) return reply('I could not find out who owns me. Add `OWNER_IDS=your-discord-user-id` to the `.env` file and restart me.');
    if (!isOwner(interaction.user.id)) return reply('Only the person who runs this bot can use `/owner`.');
    const { access } = interaction.client.services; const o = interaction.options; const sub = o.getSubcommand();
    if (sub === 'backup') {
        try { const r = createBackup(interaction.client.db); return reply(`✅ Backup ${r.existed ? 'already exists' : 'saved'}: \`data/backups/${path.basename(r.file)}\` (${mb(r.size)}). I keep the newest ${KEEP_BACKUPS}, ${r.kept} stored now. The file stays on the computer that runs me.`); }
        catch (e) { logger.error('Backup failed:', e); return reply('⚠️ The backup failed. See the console for details.'); }
    }
    if (sub === 'blacklist-add') {
        const user = o.getUser('user', true); if (isOwner(user.id) || user.id === interaction.client.user.id || user.bot) return reply('⚠️ You cannot blacklist an owner or a bot.');
        access.blacklist.add(user.id, (o.getString('reason') ?? '').slice(0, 200) || null, interaction.user.id); return reply(`✅ <@${user.id}> can no longer use me in any server.`);
    }
    if (sub === 'blacklist-remove') { const user = o.getUser('user', true); return reply(access.blacklist.remove(user.id) ? `✅ <@${user.id}> can use me again.` : `<@${user.id}> was not blacklisted.`); }
    if (sub === 'blacklist-list') { const l = access.blacklist.list(); return reply(l.length ? ['**Blacklisted users**', ...l.map((b) => `<@${b.userId}> (\`${b.userId}\`) · ${b.reason ?? 'no reason'}`)].join('\n').slice(0, 1900) : 'Nobody is blacklisted.'); }
    if (sub === 'servers') {
        const gs = [...interaction.client.guilds.cache.values()].sort((a, b) => b.memberCount - a.memberCount).slice(0, 25);
        return reply([`**Servers (${interaction.client.guilds.cache.size})**`, ...gs.map((g) => `${g.name} · \`${g.id}\` · ${g.memberCount} members`)].join('\n').slice(0, 1900));
    }
    if (sub === 'errors-set') {
        const ch = o.getChannel('channel', true); const me = ch.guild?.members?.me;
        if (me && !ch.permissionsFor(me)?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) return reply('⚠️ I need to see and write in that channel (View Channel, Send Messages, Embed Links).');
        access.config.set(ERROR_KEY, ch.id); return reply(`✅ Errors will be reported in <#${ch.id}>. Pick a **private** channel: error text can contain technical details. Test it with \`/owner errors-test\`.`);
    }
    if (sub === 'errors-off') { access.config.delete(ERROR_KEY); return reply('✅ Error alerts are off.'); }
    if (sub === 'errors-test') { logger.error('Test alert from /owner errors-test (nothing is wrong).'); return reply(access.config.get(ERROR_KEY) ? '✅ Test sent (look in the alert channel; a repeat within a minute is skipped).' : 'No alert channel is set. Use `/owner errors-set` first.'); }
}

// ---------- background ----------
function startOwnerSchedulers(client, db) {
    loadOwners(client).then((ids) => { if (!ids.length) logger.warn('I could not find out who owns this bot, so /owner is locked. Add OWNER_IDS=your-user-id to .env'); });
    installErrorAlerts(client);
    const run = () => { try { if (Date.now() - lastBackupTime() >= BACKUP_EVERY_MS - 60000) { const r = createBackup(db); logger.info(`Database backup saved: ${path.basename(r.file)} (${mb(r.size)})`); } } catch (e) { logger.error('Automatic backup failed:', e); } };
    setTimeout(run, 120000).unref?.();
    return setInterval(run, 3600000);
}

module.exports = { loadOwners, isOwner, setOwnersForTest, idsFromApplication, createBackup, listBackups, lastBackupTime, installErrorAlerts, alertError, handleBotInfo, handleOwnerCommand, startOwnerSchedulers, BACKUP_DIR, KEEP_BACKUPS, ERROR_KEY };
