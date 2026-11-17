// Raid mode: spot a sudden wave of joins, slow everything down, warn staff, and switch back when it is over.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');
const { respond, ensureModerator } = require('../moderation/helpers');
const { HIGH, TIMEOUT_MS, ACTIONS, createJoinTracker, isExpired, describeAction } = require('./rules');

const tracker = createJoinTracker();
const NO_PING = { parse: [] };
const PERM = PermissionFlagsBits.ManageGuild;
const canManage = (member) => Boolean(member?.permissions?.has?.(PERM));
const endRow = (guildId) => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`rm:end:${guildId}`).setLabel('End raid mode').setStyle(ButtonStyle.Success).setEmoji('✅'));

function alertEmbed(ev, cfg, notes, { ended = false, endedBy = null } = {}) {
    const e = new EmbedBuilder().setColor(ended ? 0x57f287 : 0xe74c3c).setTitle(ended ? '✅ Raid mode ended' : '🚨 Raid mode is ON')
        .setDescription(ended ? `Settings were put back. ${endedBy ? `Ended by ${endedBy}.` : ''}` : ev.auto ? `**${cfg.joins}+ members joined within ${cfg.seconds} seconds.** I switched on protection.` : 'A staff member switched this on.')
        .addFields({ name: 'Raiders so far', value: String(ev.raiders), inline: true }, { name: 'New joiners will', value: describeAction(cfg.action), inline: true })
        .setTimestamp();
    if (notes.length) e.addFields({ name: 'What I did', value: notes.join('\n').slice(0, 1000) });
    if (!ended) e.setFooter({ text: `Ends by itself ${cfg.durationMinutes} min after the last raider joined.` });
    return e;
}

async function punish(guild, userId, action, reason) {
    if (action === 'alert') return false;
    const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user?.bot) return false;
    try {
        if (action === 'kick') { if (member.kickable === false) return false; await member.kick(reason); return true; }
        if (action === 'timeout') { if (member.moderatable === false) return false; await member.timeout(TIMEOUT_MS, reason); return true; }
    } catch (error) { logger.warn(`Raid action failed in ${guild.id}: ${error.message}`); }
    return false;
}

// Switches protection on. Returns the event, or null if a raid is already active.
async function startRaid(client, guild, { auto, ids = [], by = null } = {}) {
    const { raid } = client.services; const cfg = raid.getConfig(guild.id); const notes = [];
    let prev = null, set = null, paused = false;
    if (cfg.raiseVerification && typeof guild.setVerificationLevel === 'function' && (guild.verificationLevel ?? 0) < HIGH) {
        try { prev = guild.verificationLevel ?? 0; await guild.setVerificationLevel(HIGH, 'Raid mode'); set = HIGH; notes.push('🔒 Raised the verification level to **High**.'); } catch (e) { prev = null; notes.push('⚠️ Could not raise the verification level (I need **Manage Server**).'); }
    }
    if (cfg.pauseInvites) {
        if (typeof guild.disableInvites === 'function' && !guild.invitesDisabled) {
            try { await guild.disableInvites(true); paused = true; notes.push('⏸️ Paused invites.'); } catch (e) { notes.push('⚠️ Could not pause invites (I need **Manage Server**).'); }
        } else if (typeof guild.disableInvites !== 'function') notes.push('ℹ️ Pausing invites needs a newer discord.js (skipped).');
    }
    const id = raid.start(guild.id, { auto, raiders: ids.length, prevVerification: prev, setVerification: set, invitesPaused: paused });
    if (id == null) { // someone else started it a moment ago: undo what we just did
        if (paused) await guild.disableInvites(false).catch(() => {}); if (set != null) await guild.setVerificationLevel(prev).catch(() => {});
        return null;
    }
    let handled = 0; for (const uid of ids) if (await punish(guild, uid, cfg.action, 'Raid mode')) handled++;
    if (handled) notes.push(`${cfg.action === 'kick' ? '👢 Kicked' : '⏳ Timed out'} **${handled}** of the first raiders.`);
    const ev = raid.get(id);
    const channel = cfg.alertChannelId ? (guild.channels.cache.get(cfg.alertChannelId) ?? await guild.channels.fetch(cfg.alertChannelId).catch(() => null)) : null;
    if (channel?.send) {
        try {
            const sent = await channel.send({ content: cfg.alertRoleId ? `<@&${cfg.alertRoleId}>` : undefined, embeds: [alertEmbed(ev, cfg, notes)], components: [endRow(guild.id)], allowedMentions: cfg.alertRoleId ? { roles: [cfg.alertRoleId] } : NO_PING });
            raid.setAlert(id, channel.id, sent?.id ?? null);
        } catch (e) { logger.warn(`Raid alert failed in ${guild.id}: ${e.message}`); }
    }
    return { ...ev, notes };
}

// Switches protection off and puts the old settings back. Only the first call does anything.
async function endRaid(client, guildId, by) {
    const { raid } = client.services; const ev = raid.active(guildId); if (!ev) return null;
    const done = raid.end(ev.id, by); if (!done) return null;
    tracker.clear(guildId);
    const guild = client.guilds.cache.get(guildId); const notes = [];
    if (guild) {
        if (done.setVerification != null && done.prevVerification != null && guild.verificationLevel === done.setVerification) { try { await guild.setVerificationLevel(done.prevVerification, 'Raid mode ended'); notes.push('Verification level put back.'); } catch { notes.push('Could not put the verification level back: please check it.'); } }
        if (done.invitesPaused && typeof guild.disableInvites === 'function') { try { await guild.disableInvites(false); notes.push('Invites resumed.'); } catch { notes.push('Could not resume invites: please check Server Settings → Invites.'); } }
        const ch = done.alertChannelId && (guild.channels.cache.get(done.alertChannelId) ?? await guild.channels.fetch(done.alertChannelId).catch(() => null));
        if (ch?.messages?.fetch && done.alertMessageId) {
            const msg = await ch.messages.fetch(done.alertMessageId).catch(() => null);
            await msg?.edit?.({ content: null, embeds: [alertEmbed(done, raid.getConfig(guildId), notes, { ended: true, endedBy: by === 'auto' ? null : `<@${by}>` })], components: [], allowedMentions: NO_PING }).catch(() => {});
        } else if (ch?.send) await ch.send({ embeds: [alertEmbed(done, raid.getConfig(guildId), notes, { ended: true })], allowedMentions: NO_PING }).catch(() => {});
    }
    return { ...done, notes };
}

// Every new member goes through here.
async function handleRaidJoin(member, { nowMs = Date.now() } = {}) {
    const client = member.client; const { raid } = client.services; const guild = member.guild;
    if (!raid || member.user?.bot || !raid.isEnabled(guild.id)) return;
    const cfg = raid.getConfig(guild.id); const active = raid.active(guild.id);
    if (active) { // raid in progress: this member is a raider too and the clock restarts
        raid.addRaider(active.id);
        if (await punish(guild, member.id, cfg.action, 'Raid mode')) logger.info(`Raid mode: ${cfg.action} ${member.id} in ${guild.id}`);
        return;
    }
    const ids = tracker.record(guild.id, member.id, nowMs, cfg);
    if (ids) await startRaid(client, guild, { auto: true, ids });
}

function startRaidScheduler(client) {
    const run = async () => {
        const { raid } = client.services; const nowMs = Date.now();
        for (const ev of raid.activeEvents()) {
            const cfg = raid.getConfig(ev.guildId);
            if (isExpired(ev.lastJoinAt, cfg.durationMinutes, nowMs)) await endRaid(client, ev.guildId, 'auto').catch((e) => logger.warn(`Ending raid mode failed: ${e.message}`));
        }
    };
    return setInterval(() => { run().catch((e) => logger.warn(`Raid scheduler failed: ${e.message}`)); }, 30 * 1000);
}

async function handleRaidComponent(interaction) {
    const [, action, guildId] = interaction.customId.split(':');
    if (action !== 'end' || interaction.guildId !== guildId) return interaction.reply({ content: 'That button is not valid here.', flags: MessageFlags.Ephemeral });
    if (!canManage(interaction.member)) return interaction.reply({ content: 'You need **Manage Server** to end raid mode.', flags: MessageFlags.Ephemeral });
    const r = await endRaid(interaction.client, guildId, interaction.user.id);
    return interaction.reply({ content: r ? '✅ Raid mode ended. Settings were put back.' : 'Raid mode was already over.', flags: MessageFlags.Ephemeral });
}

async function handleRaidCommand(interaction) {
    const { raid } = interaction.client.services; const o = interaction.options; const g = interaction.guildId; const sub = o.getSubcommand();
    if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
    if (sub === 'setup') {
        const patch = { joins: o.getInteger('joins') ?? undefined, seconds: o.getInteger('seconds') ?? undefined, action: o.getString('action') ?? undefined, durationMinutes: o.getInteger('duration') ?? undefined,
            alertChannelId: o.getChannel('alert_channel')?.id, alertRoleId: o.getRole('alert_role')?.id, raiseVerification: o.getBoolean('raise_verification') ?? undefined, pauseInvites: o.getBoolean('pause_invites') ?? undefined };
        let cfg; try { cfg = raid.configure(g, { ...patch, enabled: true }); } catch (e) { return respond(interaction, e.message, { ephemeral: true }); }
        return respond(interaction, `✅ Raid mode watching is **on**: ${cfg.joins} joins in ${cfg.seconds} seconds starts it. New joiners will: **${describeAction(cfg.action)}**. It ends ${cfg.durationMinutes} min after the last raider. ${cfg.alertChannelId ? `Alerts go to <#${cfg.alertChannelId}>.` : '⚠️ No alert channel yet: set `alert_channel` so staff get warned.'}`);
    }
    if (sub === 'enable' || sub === 'disable') { raid.configure(g, { enabled: sub === 'enable' }); return respond(interaction, sub === 'enable' ? '✅ Raid detection is **on**.' : '✅ Raid detection is **off**. A raid already running keeps going until it ends.'); }
    if (sub === 'start') {
        if (raid.active(g)) return respond(interaction, 'Raid mode is already on.', { ephemeral: true });
        await interaction.deferReply?.();
        const r = await startRaid(interaction.client, interaction.guild, { auto: false, by: interaction.user.id });
        return respond(interaction, r ? `🚨 Raid mode is **on**.\n${r.notes.join('\n') || ''}\nUse \`/raidmode end\` when it is over.` : 'Raid mode is already on.');
    }
    if (sub === 'end') { const r = await endRaid(interaction.client, g, interaction.user.id); return respond(interaction, r ? `✅ Raid mode ended. ${r.notes.join(' ')}` : 'Raid mode is not on.'); }
    if (sub === 'status') {
        const cfg = raid.getConfig(g); const ev = raid.active(g); const hist = raid.history(g, 3);
        const lines = [`**Raid detection:** ${cfg.enabled ? 'on' : 'off'} (${cfg.joins} joins in ${cfg.seconds}s → ${describeAction(cfg.action)}; ends ${cfg.durationMinutes} min after the last raider)`,
            `Raise verification: ${cfg.raiseVerification ? 'yes' : 'no'} · Pause invites: ${cfg.pauseInvites ? 'yes' : 'no'}`, `Alerts: ${cfg.alertChannelId ? `<#${cfg.alertChannelId}>` : 'not set'}${cfg.alertRoleId ? ` (pings <@&${cfg.alertRoleId}>)` : ''}`,
            ev ? `🚨 **Raid mode is ON** since <t:${Math.floor(ev.startedAt / 1000)}:R>, ${ev.raiders} raiders.` : 'No raid right now.'];
        if (hist.length) lines.push('Recent: ' + hist.map((h) => `<t:${Math.floor(h.startedAt / 1000)}:d> (${h.raiders} raiders)`).join(', '));
        return respond(interaction, lines.join('\n'));
    }
}

module.exports = { handleRaidJoin, startRaid, endRaid, startRaidScheduler, handleRaidComponent, handleRaidCommand, tracker, punish, alertEmbed };
