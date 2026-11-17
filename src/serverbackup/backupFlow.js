// /serverbackup: save and restore the structure of a server (roles, channels, permissions).
const crypto = require('node:crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const { respond, ensureModerator } = require('../moderation/helpers');
const { buildSnapshot, serialize, parseSnapshot, planRestore, SUPPORTED, describeType } = require('./snapshot');
const { runRestore } = require('./restore');

const PERM = PermissionFlagsBits.Administrator;
const PENDING_MS = 5 * 60 * 1000, COLOR = 0x5865f2;
const pending = new Map(); // token -> { userId, guildId, backupId, fixExisting, settings, expires }
const running = new Set(); // servers with a restore in progress
const NOBODY = { parse: [] };

const currentState = (guild) => ({
    roles: [...guild.roles.cache.values()].filter((r) => r.id !== guild.id).map((r) => ({ id: r.id, name: r.name })),
    channels: [...guild.channels.cache.values()].filter((c) => SUPPORTED.has(c.type)).map((c) => ({ id: c.id, name: c.name, type: c.type, parentName: c.parent?.name ?? null })),
});
const ts = (ms) => `<t:${Math.floor(ms / 1000)}:f>`;

// Saves a backup. Used by the command and by the automatic schedule.
async function takeBackup(client, guild, { name, by, auto = false }) {
    await guild.roles.fetch().catch(() => {}); await guild.channels.fetch().catch(() => {});
    const snap = buildSnapshot(guild); const data = serialize(snap);
    return client.services.backups.create(guild.id, { name, by, data, roles: snap.roles.length, channels: snap.channels.length, auto });
}

async function autoBackupTick(client, nowMs = Date.now()) {
    const { backups } = client.services;
    for (const gid of backups.autoGuilds()) {
        const guild = client.guilds.cache.get(gid); if (!guild || !backups.claimAuto(gid, nowMs)) continue;
        try { await takeBackup(client, guild, { name: `Automatic ${new Date(nowMs).toISOString().slice(0, 10)}`, by: client.user.id, auto: true }); }
        catch (e) { logger.warn(`Automatic backup failed in ${gid}: ${e.message}`); }
    }
}
function startBackupScheduler(client) { return setInterval(() => { autoBackupTick(client).catch((e) => logger.warn(`Backup scheduler failed: ${e.message}`)); }, 10 * 60 * 1000); }

function previewPayload(meta, plan, token, warnings) {
    const s = plan.summary;
    const lines = [`**${s.rolesNew}** role(s) and **${s.channelsNew}** channel(s) (${s.categoriesNew} categories) are missing and will be created.`,
        s.rolesFix || s.channelsFix ? `**${s.rolesFix}** existing role(s) and **${s.channelsFix}** existing channel(s) will get their saved permissions back.` : 'Existing roles and channels are left exactly as they are.',
        s.settings ? 'Server settings (name, verification level and similar) will be put back.' : null, '**Nothing is deleted. Messages and members are not part of a backup.**', ...warnings].filter(Boolean);
    const embed = new EmbedBuilder().setColor(COLOR).setTitle(`♻️ Restore “${meta.name}”?`).setDescription(lines.join('\n')).setFooter({ text: `Backup #${meta.id} · saved ${new Date(meta.createdAt).toISOString().slice(0, 10)} · confirm within 5 minutes` });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`sb:go:${token}`).setLabel('Confirm restore').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`sb:no:${token}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
    return { embeds: [embed], components: [row], allowedMentions: NOBODY };
}

async function handleBackupComponent(interaction) {
    const [, action, token] = interaction.customId.split(':'); const p = pending.get(token);
    const say = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!p || p.expires < Date.now()) { pending.delete(token); return interaction.update({ content: 'This restore request expired. Run `/serverbackup restore` again.', embeds: [], components: [] }); }
    if (interaction.user.id !== p.userId || interaction.guildId !== p.guildId) return say('Only the person who started this restore can press the buttons.');
    if (!interaction.memberPermissions?.has(PERM)) return say('You need the **Administrator** permission.');
    pending.delete(token);
    if (action === 'no') return interaction.update({ content: 'Restore cancelled. Nothing was changed.', embeds: [], components: [] });
    const guild = interaction.guild; const { backups } = interaction.client.services;
    if (running.has(guild.id)) return say('A restore is already running here.');
    const snap = parseSnapshot(backups.getData(guild.id, p.backupId) ?? ''); if (!snap) return interaction.update({ content: 'That backup is no longer available.', embeds: [], components: [] });
    running.add(guild.id);
    try {
        await interaction.update({ content: '⏳ Restoring… this can take a minute for big servers.', embeds: [], components: [] });
        await guild.roles.fetch().catch(() => {}); await guild.channels.fetch().catch(() => {});
        const plan = planRestore(snap, currentState(guild), { fixExisting: p.fixExisting, settings: p.settings });
        const res = await runRestore(guild, snap, plan, { botTop: guild.members?.me?.roles?.highest?.position ?? 0, reason: `Server restore by ${interaction.user.username}` });
        const lines = [`✅ **Restore finished.** Created ${res.rolesCreated} role(s) and ${res.channelsCreated} channel(s).`];
        if (res.rolesFixed || res.channelsFixed) lines.push(`Permissions put back on ${res.rolesFixed} role(s) and ${res.channelsFixed} channel(s).`);
        if (res.settings) lines.push('Server settings restored.');
        if (res.failed.length) lines.push('', '⚠️ **Some steps did not work:**', ...res.failed.map((f) => `• ${f}`), 'Usually this means my role is too low, or I am missing **Manage Roles** / **Manage Channels**. Fix that and run the restore again: it only creates what is still missing.');
        try { await interaction.editReply({ content: lines.join('\n'), allowedMentions: NOBODY }); } catch { await interaction.channel?.send?.({ content: lines.join('\n'), allowedMentions: NOBODY }).catch(() => {}); }
    } finally { running.delete(guild.id); }
}

async function handleBackupCommand(interaction) {
    const { backups } = interaction.client.services; const o = interaction.options; const g = interaction.guildId; const sub = o.getSubcommand();
    if (!(await ensureModerator(interaction, PERM, 'Administrator'))) return;
    if (sub === 'create') {
        await interaction.deferReply?.();
        try { const id = await takeBackup(interaction.client, interaction.guild, { name: o.getString('name'), by: interaction.user.id }); const m = backups.getMeta(g, id);
            return respond(interaction, `✅ Backup **#${id}** saved: ${m.roles} roles and ${m.channels} channels (with permissions). Restore it any time with \`/serverbackup restore id:${id}\`.`); }
        catch (e) { return respond(interaction, e.message?.length < 200 ? e.message : 'I could not save the backup.'); }
    }
    if (sub === 'list') {
        const list = backups.list(g); const auto = backups.getAutoDays(g);
        if (!list.length) return respond(interaction, `No backups yet. Make one with \`/serverbackup create\`.${auto ? ` (Automatic backups: every ${auto} day(s).)` : ''}`);
        return respond(interaction, [`**Server backups** (${list.length})${auto ? ` · automatic every ${auto} day(s)` : ''}`, ...list.slice(0, 15).map((b) => `**#${b.id}** ${b.auto ? '🤖 ' : ''}${b.name} · ${b.roles} roles, ${b.channels} channels · ${ts(b.createdAt)}`)].join('\n'));
    }
    if (sub === 'info') {
        const id = o.getInteger('id', true); const m = backups.getMeta(g, id); const snap = m && parseSnapshot(backups.getData(g, id));
        if (!m || !snap) return respond(interaction, 'I could not find that backup. See `/serverbackup list`.');
        const counts = {}; for (const c of snap.channels) counts[describeType(c.type)] = (counts[describeType(c.type)] ?? 0) + 1;
        return respond(interaction, [`**#${m.id} ${m.name}** ${m.auto ? '(automatic)' : ''}`, `Saved ${ts(m.createdAt)} · ${(m.size / 1024).toFixed(1)} KB`, `Roles: ${m.roles}`, `Channels: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`].join('\n'));
    }
    if (sub === 'delete') return respond(interaction, backups.remove(g, o.getInteger('id', true)) ? '✅ Backup deleted.' : 'I could not find that backup.');
    if (sub === 'auto') { try { backups.setAutoDays(g, o.getInteger('days', true)); } catch (e) { return respond(interaction, e.message); } const d = backups.getAutoDays(g); return respond(interaction, d ? `✅ I will save a backup automatically every **${d}** day(s) and keep the latest 3.` : '✅ Automatic backups are **off**.'); }
    if (sub === 'restore') {
        const id = o.getInteger('id', true); const m = backups.getMeta(g, id); const snap = m && parseSnapshot(backups.getData(g, id));
        if (!m || !snap) return respond(interaction, 'I could not find that backup. See `/serverbackup list`.');
        const guild = interaction.guild; await guild.roles.fetch().catch(() => {}); await guild.channels.fetch().catch(() => {});
        const plan = planRestore(snap, currentState(guild), { fixExisting: o.getBoolean('fix_existing') ?? false, settings: o.getBoolean('settings') ?? false });
        const me = guild.members?.me; const warnings = [];
        if (me && !me.permissions.has(PermissionFlagsBits.ManageRoles)) warnings.push('⚠️ I am missing **Manage Roles**.'); if (me && !me.permissions.has(PermissionFlagsBits.ManageChannels)) warnings.push('⚠️ I am missing **Manage Channels**.');
        const s = plan.summary; if (!s.rolesNew && !s.channelsNew && !s.rolesFix && !s.channelsFix && !s.settings) return respond(interaction, 'Everything in this backup already exists here. There is nothing to restore. (Add `fix_existing:true` to also put saved permissions back.)');
        const token = crypto.randomBytes(8).toString('hex'); for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
        pending.set(token, { userId: interaction.user.id, guildId: g, backupId: id, fixExisting: plan.rolesToFix.length + plan.channelsToFix.length > 0 || (o.getBoolean('fix_existing') ?? false), settings: o.getBoolean('settings') ?? false, expires: Date.now() + PENDING_MS });
        return respond(interaction, null, previewPayload(m, plan, token, warnings));
    }
}

module.exports = { handleBackupCommand, handleBackupComponent, takeBackup, autoBackupTick, startBackupScheduler, currentState, pending, running, previewPayload };
