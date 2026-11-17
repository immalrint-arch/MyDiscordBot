// "Check my setup": finds the problems that make beginners think the bot is broken.
const { PermissionFlagsBits } = require('discord.js');
const { snapshot } = require('./status');

// What each permission is for. `critical` = most features break without it.
const PERMISSIONS = [
    ['ViewChannel', 'View Channels', 'see channels and messages', true], ['SendMessages', 'Send Messages', 'reply to commands', true], ['EmbedLinks', 'Embed Links', 'show pretty messages (embeds)', true],
    ['ReadMessageHistory', 'Read Message History', 'quotes, purge, panels', false], ['AttachFiles', 'Attach Files', 'welcome cards, level cards, quote pictures, transcripts', false],
    ['ManageMessages', 'Manage Messages', '/purge, auto-mod deleting messages, pins', false], ['ModerateMembers', 'Timeout Members', '/timeout, auto-mod timeouts', false],
    ['KickMembers', 'Kick Members', '/kick', false], ['BanMembers', 'Ban Members', '/ban, /unban, anti-nuke', false],
    ['ManageRoles', 'Manage Roles', 'auto-roles, role panels, verification, level roles, quarantine', false], ['ManageChannels', 'Manage Channels', 'lock, lockdown, tickets, temporary voice, quarantine', false],
    ['ManageNicknames', 'Manage Nicknames', '/nick, /sanitize', false], ['ViewAuditLog', 'View Audit Log', 'anti-nuke (who did it) and accurate logs', false],
    ['MoveMembers', 'Move Members', '/vc kick and /vc move, temporary voice', false], ['MuteMembers', 'Mute Members', '/vc mute', false], ['DeafenMembers', 'Deafen Members', '/vc deafen', false],
    ['ManageGuild', 'Manage Server', 'invite logs', false], ['ManageEvents', 'Manage Events', 'server events', false], ['AddReactions', 'Add Reactions', 'reaction role panels', false],
];

// has(flag) -> boolean. Returns [{ flag, label, why, critical, ok }]
function checkPermissions(has) {
    return PERMISSIONS.map(([flag, label, why, critical]) => ({ flag, label, why, critical, ok: PermissionFlagsBits[flag] === undefined ? true : Boolean(has(PermissionFlagsBits[flag])) }));
}

// Roles I cannot manage because they sit at or above my highest role. roles: [{ id, name, position, managed }]
function rolesAboveMe(roles, botPosition, everyoneId) {
    return roles.filter((r) => r.id !== everyoneId && !r.managed && r.position >= botPosition).sort((a, b) => b.position - a.position);
}

// Every place I am told to write. Returns [{ label, id }]
function configuredChannels(s, logChannels = {}) {
    const list = [['Default log channel', s.logGeneralChannelId], ['Ban appeals', s.appealChannelId], ['Anti-nuke alerts', s.antinuke.alertChannelId], ['Ticket log', s.tickets.logChannelId],
        ['Reports', s.reports.channelId], ['Welcome', s.welcome.channelId], ['Goodbye', s.goodbye.channelId], ['Confessions', s.confessions.channelId], ['Suggestions', s.suggestionsChannelId],
        ['Starboard', s.starboard.channelId], ['Quarantine channel', s.quarantine.channelId], ['Level highlights', s.leveling.highlightsChannelId]];
    for (const [category, id] of Object.entries(logChannels)) list.push([`${category} log`, id]);
    const seen = new Set();
    return list.filter(([, id]) => id && !seen.has(`${id}`) && seen.add(`${id}`)).map(([label, id]) => ({ label, id }));
}
// Every role I am told to give.
function configuredRoles(s, extra = []) {
    const list = [['Verified role', s.verification.verifiedRoleId], ['Unverified role', s.verification.unverifiedRoleId], ['Quarantine role', s.quarantine.roleId], ...extra];
    return list.filter(([, id]) => id).map(([label, id]) => ({ label, id }));
}

async function runHealth(client, guild, { canvasProblem = null } = {}) {
    const me = await guild.members.fetchMe();
    const snap = snapshot(client, guild);
    const sections = [];

    const perms = checkPermissions((flag) => me.permissions.has(flag));
    const missing = perms.filter((p) => !p.ok);
    sections.push({ title: '🔑 My permissions', ok: missing.length === 0,
        lines: missing.length ? missing.map((p) => `❌ **${p.label}**${p.critical ? ' (important!)' : ''} — needed for ${p.why}`) : ['✅ I have every permission I use.'],
        fix: missing.length ? 'Fix: **Server Settings → Roles → Incomu** and switch those on (or give me Administrator for the easiest start).' : null });

    const botPosition = me.roles.highest.position;
    const above = rolesAboveMe([...guild.roles.cache.values()].map((r) => ({ id: r.id, name: r.name, position: r.position, managed: r.managed })), botPosition, guild.id);
    sections.push({ title: '📶 My role position', ok: above.length === 0,
        lines: above.length ? [`⚠️ **${above.length}** role(s) are above mine, so I cannot punish or edit people who have them: ${above.slice(0, 6).map((r) => `<@&${r.id}>`).join(' ')}${above.length > 6 ? ' …' : ''}`] : ['✅ My role is above all normal roles.'],
        fix: above.length ? 'If those are moderator/member roles: drag **Incomu** above them in **Server Settings → Roles**. (Owner/admin roles above me are fine.)' : null });

    const logChannels = (() => { try { return client.services.logConfig.listChannels(guild.id); } catch { return {}; } })();
    const problems = [];
    for (const { label, id } of configuredChannels(snap, logChannels)) {
        const channel = guild.channels.cache.get(id);
        if (!channel) { problems.push(`❌ **${label}**: the channel was deleted (<#${id}>)`); continue; }
        const p = channel.permissionsFor?.(me);
        const need = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
        if (p && !p.has(need)) problems.push(`❌ **${label}** <#${id}>: I cannot ${[['View', PermissionFlagsBits.ViewChannel], ['Send in', PermissionFlagsBits.SendMessages], ['Embed in', PermissionFlagsBits.EmbedLinks]].filter(([, f]) => !p.has(f)).map(([t]) => t.toLowerCase()).join(' / ')} it`);
    }
    const seenChannels = configuredChannels(snap, logChannels).length;
    sections.push({ title: '💬 Channels I write in', ok: problems.length === 0,
        lines: problems.length ? problems.slice(0, 10) : [seenChannels ? `✅ I can write in all ${seenChannels} configured channel(s).` : 'ℹ️ No channels are configured yet. Start with the Logs guide.'],
        fix: problems.length ? 'Fix: open that channel → **Edit Channel → Permissions** → allow **Incomu** to View, Send Messages and Embed Links. Or set a new channel with the command shown in `/setup`.' : null });

    const roleProblems = [];
    for (const { label, id } of configuredRoles(snap)) {
        const role = guild.roles.cache.get(id);
        if (!role) roleProblems.push(`❌ **${label}**: the role was deleted`);
        else if (role.position >= botPosition) roleProblems.push(`⚠️ **${label}** <@&${id}> is above my role, so I cannot give or remove it`);
    }
    if (snap.tickets.categoryId && !guild.channels.cache.get(snap.tickets.categoryId)) roleProblems.push('❌ **Ticket category** was deleted');
    sections.push({ title: '🎭 Roles I hand out', ok: roleProblems.length === 0, lines: roleProblems.length ? roleProblems : ['✅ The roles I use exist and are below mine.'],
        fix: roleProblems.length ? 'Fix: re-run the matching command from `/setup`, and drag **Incomu** above those roles.' : null });

    sections.push({ title: '🖼️ Pictures', ok: !canvasProblem,
        lines: [canvasProblem ? `⚠️ Welcome cards, level cards and quote pictures fall back to plain embeds (${canvasProblem}).` : '✅ Picture cards are available.'],
        fix: canvasProblem ? 'Fix (for whoever hosts the bot): run `npm install @napi-rs/canvas` and restart.' : null });

    const problemCount = sections.filter((s) => !s.ok).length;
    return { sections, problemCount, snap };
}

module.exports = { PERMISSIONS, checkPermissions, rolesAboveMe, configuredChannels, configuredRoles, runHealth };
