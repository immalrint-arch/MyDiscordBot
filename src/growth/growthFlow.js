// Invite tracker, sticky roles and member counters.
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const R = require('./rules');
const { respond, ensureModerator } = require('../moderation/helpers');
const { GrowthServiceError } = require('../services/growthService');

const MANAGE = PermissionFlagsBits.ManageGuild, CHANNELS = PermissionFlagsBits.ManageChannels;
const COLOR = 0x5865f2;
const embedOf = (description, title) => { const e = new EmbedBuilder().setColor(COLOR).setDescription(description.slice(0, 4000)); if (title) e.setTitle(title); return e; };
const reply = (i, embed) => respond(i, '', { embeds: [embed] });
async function say(guild, services, category, description, userId) { try { await services.logs?.send(guild, category, { embeds: [embedOf(description)] }, { userId }); } catch (e) { logger.warn(`Growth log failed: ${e.message}`); } }

// ===================== invite tracker =====================
const inviteCache = new Map(); // guildId -> Map(code -> { uses, maxUses, inviterId })
const queues = new Map(); // guildId -> promise: joins are handled one at a time so two joins never mix up
const toSnapshot = (invites) => [...invites.values()].map((i) => ({ code: i.code, uses: i.uses ?? 0, maxUses: i.maxUses ?? 0, inviterId: i.inviter?.id ?? i.inviterId ?? null }));
const toMap = (list) => new Map(list.map((i) => [i.code, { uses: i.uses, maxUses: i.maxUses, inviterId: i.inviterId }]));

// Reads the invite list. null = I am not allowed to (needs Manage Server).
async function readInvites(guild) { try { return toSnapshot(await guild.invites.fetch()); } catch { return null; } }
async function refreshInviteCache(guild) { const list = await readInvites(guild); if (list) inviteCache.set(guild.id, toMap(list)); return list !== null; }
async function warmInviteCaches(client) {
    for (const guild of client.guilds.cache.values()) { try { if (client.services.growth.invites.isEnabled(guild.id)) await refreshInviteCache(guild); } catch (e) { logger.warn(`Invite cache failed for ${guild.id}: ${e.message}`); } }
}
function onInviteChange(invite, deleted) {
    const gid = invite.guild?.id; const cache = gid && inviteCache.get(gid); if (!cache) return;
    if (deleted) { return; } // keep it: the join handler needs it to spot a used-up invite
    cache.set(invite.code, { uses: invite.uses ?? 0, maxUses: invite.maxUses ?? 0, inviterId: invite.inviter?.id ?? null });
}
async function handleInviteJoin(member) {
    const { growth } = member.client.services; const guild = member.guild;
    if (member.user.bot || !growth.invites.isEnabled(guild.id)) return;
    const run = async () => {
        const before = inviteCache.get(guild.id) ?? new Map(); const after = await readInvites(guild);
        let found = null; if (after) { found = R.detectInvite(before, after); inviteCache.set(guild.id, toMap(after)); }
        const fake = R.isFakeAccount(member.user.createdTimestamp, Date.now());
        growth.invites.recordJoin(guild.id, member.id, { inviterId: found?.inviterId ?? null, code: found?.code ?? null, fake });
        const text = found ? `<@${member.id}> joined with invite \`${found.code}\`${found.inviterId ? ` from <@${found.inviterId}>` : ''}.${fake ? '\n⚠️ Their account is less than 7 days old (counted as fake).' : ''}`
            : `<@${member.id}> joined, but I could not tell which invite was used.${after ? ' (It may be a vanity link, a Discord discovery join, or two people joined at once.)' : ' I need the **Manage Server** permission to see invites.'}`;
        await say(guild, member.client.services, 'members', text, member.id);
    };
    const next = (queues.get(guild.id) ?? Promise.resolve()).then(run).catch((e) => logger.warn(`Invite tracking failed: ${e.message}`));
    queues.set(guild.id, next); await next; if (queues.get(guild.id) === next) queues.delete(guild.id);
}
const handleInviteLeave = (member) => { try { member.client.services.growth.invites.recordLeave(member.guild.id, member.id); } catch (e) { logger.warn(`Invite leave failed: ${e.message}`); } };

const line = (s) => `**${s.net}** invites · ${s.joins} joined · ${s.left} left · ${s.fake} fake`;
async function handleInvitesCommand(interaction) {
    const { growth } = interaction.client.services; const o = interaction.options; const g = interaction.guildId; const sub = o.getSubcommand(); const inv = growth.invites;
    if (['enable', 'disable', 'who', 'reset'].includes(sub) && !(await ensureModerator(interaction, MANAGE, 'Manage Server'))) return;
    if (sub === 'enable') {
        inv.setEnabled(g, true); const ok = await refreshInviteCache(interaction.guild);
        return respond(interaction, ok ? '✅ Invite tracking is **on**. From now on I record who invited each new member.' : '✅ Invite tracking is on, but I cannot see your invites yet. Give me the **Manage Server** permission, then run `/invites enable` again.');
    }
    if (sub === 'disable') { inv.setEnabled(g, false); inviteCache.delete(g); return respond(interaction, '✅ Invite tracking is **off**. Saved numbers are kept.'); }
    if (sub === 'reset') { if (!o.getBoolean('confirm', true)) return respond(interaction, 'Nothing was deleted. Run it again with `confirm:true` to erase all invite numbers.'); const n = inv.reset(g); return respond(interaction, `🗑️ Erased the invite records of ${n} member${n === 1 ? '' : 's'}.`); }
    if (!inv.isEnabled(g) && !inv.total(g)) return respond(interaction, 'Invite tracking is off. A staff member can turn it on with `/invites enable`.');
    if (sub === 'top') {
        const top = inv.top(g, 10); if (!top.length) return respond(interaction, 'Nobody has invited anyone yet (since tracking started).');
        return reply(interaction, embedOf(top.map((t, i) => `**${i + 1}.** <@${t.inviterId}> · ${line(t)}`).join('\n'), '🏆 Top inviters'));
    }
    if (sub === 'who') {
        const user = o.getUser('user', true); const r = inv.inviterOf(g, user.id);
        if (!r) return respond(interaction, `I have no invite record for <@${user.id}> (they joined before tracking, or I could not tell).`);
        return respond(interaction, `<@${user.id}> joined <t:${Math.floor(r.joinedAt / 1000)}:R>${r.inviterId ? ` with an invite from <@${r.inviterId}>` : ', but I could not tell which invite'}${r.code ? ` (\`${r.code}\`)` : ''}${r.joins > 1 ? `. They have joined ${r.joins} times.` : '.'}`);
    }
    const user = o.getUser('user') ?? interaction.user;
    return reply(interaction, embedOf(`<@${user.id}>\n${line(inv.stats(g, user.id))}\n\n*Fake = the invited account was less than ${R.FAKE_ACCOUNT_DAYS} days old. People who rejoin count once.*`, 'Invites'));
}

// ===================== sticky roles =====================
function roleFlags() { return PermissionFlagsBits; }
async function saveStickyRoles(member) {
    const { growth } = member.client.services; if (!growth.stickyRoles.isEnabled(member.guild.id) || member.user?.bot || !member.roles?.cache) return;
    const ids = [...member.roles.cache.values()].filter((r) => r.id !== member.guild.id && !r.managed && !R.isDangerousRole(r, roleFlags())).map((r) => r.id);
    growth.stickyRoles.save(member.guild.id, member.id, ids);
}
async function restoreStickyRoles(member) {
    const { growth, quarantine } = member.client.services; const g = member.guild.id; if (!growth.stickyRoles.isEnabled(g) || member.user?.bot) return;
    if (quarantine?.get?.(g, member.id)) return; // a quarantined person must not get roles back
    const saved = growth.stickyRoles.take(g, member.id); if (!saved?.length) return;
    const roles = saved.map((id) => member.guild.roles.cache.get(id)).filter((r) => r && !r.managed && r.editable !== false && !R.isDangerousRole(r, roleFlags()));
    if (!roles.length) return;
    try { await member.roles.add(roles.map((r) => r.id), 'Sticky roles: restored after rejoining'); await say(member.guild, member.client.services, 'members', `Restored ${roles.length} role${roles.length === 1 ? '' : 's'} to <@${member.id}> (${roles.map((r) => `<@&${r.id}>`).join(' ').slice(0, 500)}).`, member.id); }
    catch (e) { logger.warn(`Sticky roles failed in ${g}: ${e.message}`); }
}
async function handleStickyRolesCommand(interaction) {
    if (!(await ensureModerator(interaction, MANAGE, 'Manage Server'))) return;
    const { growth } = interaction.client.services; const s = growth.stickyRoles; const g = interaction.guildId; const sub = interaction.options.getSubcommand();
    if (sub === 'enable') { s.setEnabled(g, true); return respond(interaction, '✅ Sticky roles are **on**. When someone leaves and rejoins within 90 days, I give back their ordinary roles. Roles with staff powers and bot roles are never given back.'); }
    if (sub === 'disable') { s.setEnabled(g, false); return respond(interaction, '✅ Sticky roles are **off**. Saved roles are kept until they expire.'); }
    if (sub === 'forget') { const u = interaction.options.getUser('user', true); return respond(interaction, s.forget(g, u.id) ? `🗑️ Forgot the saved roles of <@${u.id}>.` : `I had no saved roles for <@${u.id}>.`); }
    return respond(interaction, `**Sticky roles:** ${s.isEnabled(g) ? 'on ✅' : 'off ⛔'} · ${s.count(g)} member${s.count(g) === 1 ? '' : 's'} with saved roles.`);
}

// ===================== member counters =====================
function counterStats(guild) {
    const complete = guild.members?.cache && guild.members.cache.size >= guild.memberCount;
    const bots = complete ? guild.members.cache.filter((m) => m.user.bot).size : undefined;
    return { members: guild.memberCount, humans: complete ? guild.memberCount - bots : undefined, bots, boosts: guild.premiumSubscriptionCount ?? 0, boostlevel: guild.premiumTier ?? 0, channels: guild.channels?.cache?.size, roles: guild.roles?.cache?.size };
}
// Renames one counter channel if its text changed and the 10 minute gap has passed. Returns 'updated' | 'same' | 'wait' | 'unknown' | 'gone' | 'failed'.
async function updateCounter(client, row, t = Date.now(), { force = false } = {}) {
    const guild = client.guilds.cache.get(row.guildId); if (!guild) return 'gone';
    const name = R.renderTemplate(row.template, counterStats(guild)); if (!name) return 'unknown';
    if (name === row.lastName) return 'same';
    if (!force && t - row.lastUpdate < R.COUNTER_MIN_GAP_MS) return 'wait';
    const channel = await client.channels.fetch(row.channelId).catch((e) => (e?.code === 10003 ? 'gone' : null));
    if (channel === 'gone') { client.services.growth.counters.removeById(row.id); return 'gone'; }
    if (!channel || channel.guildId !== row.guildId) { client.services.growth.counters.markUpdated(row.id, row.lastName, t); return 'failed'; }
    try { if (channel.name !== name) await channel.setName(name, 'Member counter'); client.services.growth.counters.markUpdated(row.id, name, t); return 'updated'; }
    catch (e) { logger.warn(`Counter ${row.id} could not be renamed: ${e.message}`); client.services.growth.counters.markUpdated(row.id, row.lastName, t); return 'failed'; }
}
async function countersTick(client, t = Date.now()) { for (const row of client.services.growth.counters.all()) await updateCounter(client, row, t); }
async function handleMemberCountCommand(interaction) {
    if (!(await ensureModerator(interaction, CHANNELS, 'Manage Channels'))) return;
    const { growth } = interaction.client.services; const o = interaction.options; const g = interaction.guildId; const sub = o.getSubcommand();
    try {
        if (sub === 'list') { const l = growth.counters.list(g); return respond(interaction, l.length ? ['**Counter channels**', ...l.map((c) => `<#${c.channelId}> · \`${c.template}\``)].join('\n') : 'There are no counter channels. Add one with `/membercount add`.'); }
        const channel = o.getChannel('channel', true);
        if (sub === 'remove') return respond(interaction, growth.counters.remove(g, channel.id) ? `🗑️ <#${channel.id}> is no longer a counter. Its name stays as it is.` : `<#${channel.id}> is not a counter.`);
        const me = interaction.guild.members?.me; if (me && !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) return respond(interaction, `⚠️ I need **View Channel** and **Manage Channels** for <#${channel.id}>.`);
        const row = growth.counters.add(g, { channelId: channel.id, template: o.getString('text', true) });
        const result = await updateCounter(interaction.client, row, Date.now(), { force: true });
        return respond(interaction, result === 'updated' || result === 'same' ? `✅ <#${channel.id}> is now a live counter. It updates about every 10 minutes (Discord limits renames).` : result === 'unknown' ? '✅ Saved. A number in your text is not known yet, so the name will update later. (`{humans}` and `{bots}` need me to know all members; in big servers use `{members}`.)' : '⚠️ Saved, but I could not rename the channel. Check that I have **Manage Channels** there.');
    } catch (error) { if (error instanceof GrowthServiceError) return respond(interaction, `⚠️ ${error.message}`); throw error; }
}

function startGrowthSchedulers(client) {
    warmInviteCaches(client).catch((e) => logger.warn(`Invite cache warm-up failed: ${e.message}`));
    let running = false, last = 0;
    const run = async () => { if (running) return; running = true; try { await countersTick(client); if (Date.now() - last > 3600000) { last = Date.now(); client.services.growth.stickyRoles.purgeOld(); } } catch (e) { logger.error('Counter check failed:', e); } finally { running = false; } };
    setTimeout(run, 20000).unref?.();
    return setInterval(run, 5 * 60 * 1000);
}

module.exports = { handleInviteJoin, handleInviteLeave, onInviteChange, refreshInviteCache, warmInviteCaches, inviteCache, handleInvitesCommand, saveStickyRoles, restoreStickyRoles, handleStickyRolesCommand, counterStats, updateCounter, countersTick, handleMemberCountCommand, startGrowthSchedulers };
