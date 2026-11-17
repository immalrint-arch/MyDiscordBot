// "Quick setup": creates the staff channels and the quarantine role a new server needs, and connects them.
// Only creates what is missing, and never switches protection ON by itself.
const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const logger = require('../utils/logger');
const { CATEGORY_NAMES } = require('../logging/categories');
const { syncChannels } = require('../commands/moderation/quarantine');

// What would be created, given the current state. Pure.
function planQuick(snap) {
    const steps = [];
    if (!snap.logGeneralChannelId && snap.logCategoriesSet === 0) steps.push({ id: 'logs', label: 'Create **#incomu-logs** (staff only) and send all 8 log types there' });
    if (!snap.appealChannelId) steps.push({ id: 'appeals', label: 'Create **#ban-appeals** (staff only) for ban appeals' });
    if (!snap.reports.channelId) steps.push({ id: 'reports', label: 'Create **#reports** (staff only) for member reports (`/report`)' });
    if (!snap.quarantine.roleId || !snap.quarantine.channelId) steps.push({ id: 'quarantine', label: `${snap.quarantine.roleId ? '' : 'Create the **Quarantined** role and '}${snap.quarantine.channelId ? 'lock it out' : 'create **#quarantine**'} (the only channel quarantined members can see), then lock that role out of every other channel` });
    if (!snap.antinuke.alertChannelId) steps.push({ id: 'alerts', label: 'Send anti-nuke alerts to the log channel (anti-nuke itself stays OFF until you switch it on)' });
    return steps;
}

const STAFF_PERMS = [P.Administrator, P.ManageGuild, P.ModerateMembers, P.ManageMessages];
function staffRoleIds(guild) {
    return [...guild.roles.cache.values()].filter((r) => !r.managed && r.id !== guild.id && STAFF_PERMS.some((flag) => r.permissions?.has?.(flag))).slice(0, 10).map((r) => r.id);
}
function privateOverwrites(guild, me, { staff = true, extraAllow = [] } = {}) {
    const visible = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks];
    return [{ id: guild.id, deny: [P.ViewChannel] }, { id: me.id, allow: [...visible, P.ManageChannels, P.AttachFiles] },
        ...(staff ? staffRoleIds(guild).map((id) => ({ id, allow: visible })) : []), ...extraAllow.map((id) => ({ id, allow: visible }))];
}

// Runs the plan. Returns { lines: [text], created: n }. Each step is isolated: one failure does not stop the others.
async function runQuick(client, guild, steps, { actorTag = 'a moderator' } = {}) {
    const s = client.services; const me = await guild.members.fetchMe();
    const reason = `Incomu quick setup by ${actorTag}`; const lines = []; let created = 0;
    const makeChannel = (name, topic, overwrites) => guild.channels.create({ name, type: ChannelType.GuildText, topic, permissionOverwrites: overwrites, reason });
    const ids = new Set(steps.map((x) => x.id));
    let logChannelId = s.guildSettings.getSettings(guild.id).logChannelId;

    const attempt = async (title, fn) => { try { lines.push(`✅ ${await fn()}`); created++; } catch (error) { logger.warn(`Quick setup "${title}" failed in ${guild.id}: ${error.message}`); lines.push(`❌ ${title}: ${error.code === 50013 ? 'I am missing permissions (Manage Channels / Manage Roles)' : error.message}`); } };

    if (ids.has('logs')) await attempt('Logs', async () => {
        const channel = await makeChannel('incomu-logs', 'Incomu logs. Staff only.', privateOverwrites(guild, me));
        s.guildSettings.updateSetting(guild.id, 'logChannelId', channel.id);
        for (const category of CATEGORY_NAMES) s.logConfig.setChannel(guild.id, category, channel.id);
        logChannelId = channel.id; return `Logs → <#${channel.id}>`;
    });
    if (ids.has('appeals')) await attempt('Ban appeals', async () => {
        const channel = await makeChannel('ban-appeals', 'Ban appeals from banned users. Staff only.', privateOverwrites(guild, me));
        s.guildSettings.updateSetting(guild.id, 'appealChannelId', channel.id); return `Ban appeals → <#${channel.id}>`;
    });
    if (ids.has('reports')) await attempt('Reports', async () => {
        const channel = await makeChannel('reports', 'Member reports (/report). Staff only.', privateOverwrites(guild, me));
        s.reports.setConfig(guild.id, { channelId: channel.id }); return `Reports → <#${channel.id}>`;
    });
    if (ids.has('quarantine')) await attempt('Quarantine', async () => {
        const config = s.quarantine.getConfig(guild.id);
        let role = config.roleId ? guild.roles.cache.get(config.roleId) : null;
        if (!role) role = await guild.roles.create({ name: 'Quarantined', permissions: [], mentionable: false, reason });
        let channelId = config.channelId;
        if (!channelId || !guild.channels.cache.get(channelId)) {
            const channel = await makeChannel('quarantine', 'Quarantined members can only see this channel.', privateOverwrites(guild, me, { extraAllow: [role.id] }));
            channelId = channel.id;
        }
        s.quarantine.setConfig(guild.id, { roleId: role.id, channelId });
        const result = await syncChannels(guild, role, channelId, reason);
        return `Quarantine → role <@&${role.id}>, safe channel <#${channelId}> (locked ${result.done} channel(s)${result.failed ? `, ${result.failed} could not be changed` : ''})`;
    });
    if (ids.has('alerts') && logChannelId) await attempt('Anti-nuke alerts', async () => { s.antinukeConfig.setAlertChannel(guild.id, logChannelId); return `Anti-nuke alerts → <#${logChannelId}>`; });
    return { lines, created };
}

module.exports = { planQuick, runQuick, staffRoleIds, privateOverwrites };
