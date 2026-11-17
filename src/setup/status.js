// Works out what is already set up in a server. Pure logic (evaluate) is separate from reading the services (snapshot).
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

// Reads every system's saved settings into one plain object.
function snapshot(client, guild) {
    const s = client.services; const g = guild.id;
    const settings = safe(() => s.guildSettings.getSettings(g), {});
    const logChannels = safe(() => s.logConfig.listChannels(g), {});
    const antinuke = safe(() => s.antinukeConfig.getEffective(g), {});
    const automod = safe(() => s.automod.getConfig(g), { enabled: false, rules: {} });
    const panels = safe(() => s.roles.listPanels(g), []);
    return {
        logGeneralChannelId: settings.logChannelId ?? null, logCategoriesSet: Object.keys(logChannels).length, appealChannelId: settings.appealChannelId ?? null, dmOnAction: Boolean(settings.dmOnAction),
        antinuke: { enabled: Boolean(antinuke.enabled), mode: antinuke.configuredMode ?? null, alertChannelId: antinuke.alertChannelId ?? null, trusted: (antinuke.trustedUserIds?.length ?? 0) + (antinuke.trustedRoleIds?.length ?? 0) },
        automod: { enabled: Boolean(automod.enabled), rulesOn: Object.values(automod.rules ?? {}).filter((r) => r?.enabled).length },
        verification: safe(() => s.verification.getConfig(g), {}),
        quarantine: safe(() => s.quarantine.getConfig(g), {}),
        tickets: safe(() => s.tickets.getConfig(g), {}),
        reports: safe(() => s.reports.getConfig(g), {}),
        textCommands: safe(() => s.textCommands.getConfig(g), {}),
        welcome: safe(() => s.welcome.get(g, 'welcome'), {}), goodbye: safe(() => s.welcome.get(g, 'goodbye'), {}),
        autoroles: safe(() => s.roles.listAutoRoles(g).length, 0), rolePanels: panels.length, rolePanelsPublished: panels.filter((p) => p.messageId || p.message_id).length,
        leveling: safe(() => s.levels.getConfig(g), {}), levelRoles: safe(() => s.levels.listLevelRoles(g).length, 0),
        confessions: safe(() => s.confessions.getConfig(g), {}), suggestionsChannelId: safe(() => s.suggestions.getChannelId(g), null), starboard: safe(() => s.starboard.getConfig(g), {}),
        backupCount: safe(() => s.backups.list(g).length, 0), backupAuto: safe(() => s.backups.getAutoDays(g), 0), qotdCfg: safe(() => s.qotd.getConfig(g), {}), raidCfg: safe(() => s.raid.getConfig(g), {}), modmailCfg: safe(() => s.modmail.getConfig(g), {}), modmailOpen: safe(() => s.modmail.countOpen(g), 0), tempVoice: safe(() => s.channels.getVoiceConfig(g), {}), funConfig: safe(() => s.fun.getConfig(g), {}), counting: safe(() => s.fun.counting.getConfig(g), {}), birthdays: safe(() => s.fun.birthdays.getConfig(g), {}), bump: safe(() => s.fun.bump.getConfig(g), {}), voiceTimeOn: safe(() => s.voiceTime.isEnabled(g), false), escalationOn: safe(() => s.escalation.getConfig(g).enabled, false), escalationRules: safe(() => s.escalation.list(g).length, 0), ruleCount: safe(() => s.access.rules.count(g), 0), invitesOn: safe(() => s.growth.invites.isEnabled(g), false), stickyRolesOn: safe(() => s.growth.stickyRoles.isEnabled(g), false), counterCount: safe(() => s.growth.counters.count(g), 0), scheduledCount: safe(() => s.posts.scheduled.count(g), 0), stickyCount: safe(() => s.posts.sticky.count(g), 0), tagCount: safe(() => s.custom.tags.count(g), 0), responderCount: safe(() => s.custom.responders.list(g).filter((r) => r.enabled).length, 0), quotes: safe(() => s.quotes.getConfig(g), {}),
    };
}

const DONE = 'done', PARTIAL = 'partial', TODO = 'todo', OPTIONAL = 'optional';
const ICON = { done: '✅', partial: '🟡', todo: '⬜', optional: '➖' };
const ch = (id) => (id ? `<#${id}>` : null);

// Each system: how to tell if it is done, a one-line summary, and the next thing to type.
const SYSTEMS = [
    { id: 'logs', group: 'Foundation', title: 'Logs', essential: true, topic: 'logs', check: (s) => {
        if (s.logGeneralChannelId || s.logCategoriesSet >= 8) return [DONE, s.logGeneralChannelId ? `Default log channel ${ch(s.logGeneralChannelId)}` : 'All 8 log types have a channel'];
        if (s.logCategoriesSet > 0) return [PARTIAL, `${s.logCategoriesSet} of 8 log types have a channel`, '/logs set-all channel:#mod-log'];
        return [TODO, 'No log channel yet', '/logs set-all channel:#mod-log'];
    } },
    { id: 'appeals', group: 'Foundation', title: 'Ban appeals', essential: true, topic: 'moderation', check: (s) => (s.appealChannelId
        ? [DONE, `Appeals arrive in ${ch(s.appealChannelId)}`] : [TODO, 'Banned people cannot appeal yet', '/settings set-appeal-channel channel:#ban-appeals']) },
    { id: 'raidmode', group: 'Protection', title: 'Raid mode', topic: 'raidmode', check: (s) => (s.raidCfg?.enabled ? [DONE, `Watching: ${s.raidCfg.joins} joins in ${s.raidCfg.seconds}s${s.raidCfg.alertChannelId ? '' : ' (no alert channel yet)'}`] : [OPTIONAL, 'Off', '/raidmode setup']) },
    { id: 'serverbackup', group: 'Protection', title: 'Server backup', topic: 'serverbackup', check: (s) => (s.backupCount > 0 ? [DONE, `${s.backupCount} backup(s)${s.backupAuto ? `, automatic every ${s.backupAuto} day(s)` : ''}`] : [OPTIONAL, 'No backup yet', '/serverbackup create']) },
    { id: 'antinuke', group: 'Protection', title: 'Anti-nuke', essential: true, topic: 'security', check: (s) => {
        if (s.antinuke.enabled && s.antinuke.alertChannelId) return [DONE, `On (${s.antinuke.mode ?? 'alert'} mode), alerts in ${ch(s.antinuke.alertChannelId)}`];
        if (s.antinuke.enabled) return [PARTIAL, 'On, but no alert channel', '/antinuke alert-channel channel:#mod-log'];
        return [TODO, 'Off: nothing stops a hacked admin deleting channels', '/antinuke enable'];
    } },
    { id: 'automod', group: 'Protection', title: 'Auto-moderation', essential: true, topic: 'security', check: (s) => {
        if (s.automod.enabled && s.automod.rulesOn > 0) return [DONE, `On, ${s.automod.rulesOn} rule(s) active`];
        if (s.automod.enabled) return [PARTIAL, 'On, but no rule is active', '/automod status'];
        return [TODO, 'Off: spam and invite links are not filtered', '/automod enable'];
    } },
    { id: 'quarantine', group: 'Protection', title: 'Quarantine', essential: true, topic: 'security', check: (s) => {
        if (s.quarantine.roleId && s.quarantine.channelId) return [DONE, `Role <@&${s.quarantine.roleId}> + safe channel ${ch(s.quarantine.channelId)}`];
        if (s.quarantine.roleId) return [PARTIAL, 'Role set, but no safe channel (quarantined members see nothing)', '/quarantine setup role:@Quarantined channel:#quarantine'];
        return [TODO, 'Not set up', 'Run /setup → Quick setup, or /quarantine setup'];
    } },
    { id: 'verification', group: 'Protection', title: 'Verification (captcha)', topic: 'verification', check: (s) => {
        const v = s.verification;
        if (v.enabled && v.verifiedRoleId) return [DONE, `On, gives <@&${v.verifiedRoleId}>`];
        if (v.enabled || v.verifiedRoleId) return [PARTIAL, v.enabled ? 'On, but no Verified role' : 'Configured but switched off', v.enabled ? '/verification role role:@Verified' : '/verification enable'];
        return [OPTIONAL, 'Not used (recommended for public servers)', '/verification role role:@Verified'];
    } },
    { id: 'tickets', group: 'Staff tools', title: 'Tickets', topic: 'tickets', check: (s) => {
        const t = s.tickets; const staff = t.staffRoleIds?.length ?? 0;
        if (t.enabled && t.categoryId && staff) return [DONE, `On, ${staff} staff role(s)`];
        if (t.enabled || t.categoryId || staff) return [PARTIAL, 'Half set up', t.categoryId ? (staff ? '/ticket enable' : '/ticket staff-add role:@Support') : '/ticket category category:Support'];
        return [OPTIONAL, 'Not used', '/ticket category category:Support'];
    } },
    { id: 'reports', group: 'Staff tools', title: 'Member reports', topic: 'moderation', check: (s) => (s.reports.channelId ? [DONE, `Reports go to ${ch(s.reports.channelId)}`] : [OPTIONAL, 'Not used', '/reportconfig channel channel:#reports']) },
    { id: 'textcommands', group: 'Staff tools', title: 'Text commands (!ban)', topic: 'textcommands', check: (s) => (s.textCommands.enabled ? [DONE, `On, prefix \`${s.textCommands.prefix}\``] : [OPTIONAL, 'Off (slash commands still work)', '/textcommands enable']) },
    { id: 'welcome', group: 'Community', title: 'Welcome message', topic: 'welcome', check: (s) => {
        const w = s.welcome;
        if (w.enabled && w.channelId) return [DONE, `Greets in ${ch(w.channelId)}`];
        if (w.enabled || w.channelId) return [PARTIAL, w.enabled ? 'On, but no channel' : 'Channel set, but switched off', w.enabled ? '/welcome channel channel:#welcome' : '/welcome enable'];
        return [OPTIONAL, 'Not used', '/welcome channel channel:#welcome'];
    } },
    { id: 'goodbye', group: 'Community', title: 'Goodbye message', topic: 'welcome', check: (s) => {
        const w = s.goodbye;
        if (w.enabled && w.channelId) return [DONE, `Posts in ${ch(w.channelId)}`];
        if (w.enabled || w.channelId) return [PARTIAL, w.enabled ? 'On, but no channel' : 'Channel set, but switched off', w.enabled ? '/goodbye channel channel:#goodbye' : '/goodbye enable'];
        return [OPTIONAL, 'Not used', '/goodbye channel channel:#goodbye'];
    } },
    { id: 'roles', group: 'Community', title: 'Auto-roles & role panels', topic: 'roles', check: (s) => {
        if (s.autoroles > 0 || s.rolePanelsPublished > 0) return [DONE, `${s.autoroles} auto-role(s), ${s.rolePanelsPublished} published panel(s)`];
        if (s.rolePanels > 0) return [PARTIAL, 'A panel exists but is not published', '/rolepanel publish panel:<name> channel:#roles'];
        return [OPTIONAL, 'Not used', '/autorole add role:@Member'];
    } },
    { id: 'leveling', group: 'Community', title: 'Leveling', topic: 'leveling', check: (s) => (s.leveling.enabled ? [DONE, `On, ${s.levelRoles} level role(s)`] : [OPTIONAL, 'Off', '/level enable']) },
    { id: 'confessions', group: 'Community', title: 'Confessions', topic: 'community', check: (s) => (s.confessions.channelId ? [DONE, `In ${ch(s.confessions.channelId)}`] : [OPTIONAL, 'Not used', '/confession setup channel:#confessions']) },
    { id: 'suggestions', group: 'Community', title: 'Suggestions', topic: 'community', check: (s) => (s.suggestionsChannelId ? [DONE, `In ${ch(s.suggestionsChannelId)}`] : [OPTIONAL, 'Not used', '/suggestion setup channel:#suggestions']) },
    { id: 'starboard', group: 'Community', title: 'Starboard', topic: 'community', check: (s) => (s.starboard.channelId ? [DONE, `In ${ch(s.starboard.channelId)}, needs ${s.starboard.threshold}`] : [OPTIONAL, 'Not used', '/starboard setup channel:#starboard']) },
    { id: 'tempvoice', group: 'Community', title: 'Temporary voice rooms', topic: 'channels', check: (s) => (s.tempVoice.enabled && s.tempVoice.triggerChannelId ? [DONE, `Join ${ch(s.tempVoice.triggerChannelId)} to get a room`] : [OPTIONAL, 'Not used', '/tempvoice setup trigger:#Join-to-create']) },
    { id: 'qotd', group: 'Community', title: 'Question of the day', topic: 'qotd', check: (s) => (s.qotdCfg?.enabled ? [DONE, `Daily at ${String(s.qotdCfg.hour).padStart(2, '0')}:${String(s.qotdCfg.minute).padStart(2, '0')} in <#${s.qotdCfg.channelId}>`] : [OPTIONAL, 'Off', '/qotd setup']) },
    { id: 'custom', group: 'Community', title: 'Custom commands & auto-replies', topic: 'custom', check: (s) => ((s.tagCount ?? 0) + (s.responderCount ?? 0) > 0 ? [DONE, `${s.tagCount ?? 0} custom command${s.tagCount === 1 ? '' : 's'}, ${s.responderCount ?? 0} auto-repl${s.responderCount === 1 ? 'y' : 'ies'}`] : [OPTIONAL, 'Not used', '/tag create']) },
    { id: 'posts', group: 'Community', title: 'Announcements & scheduled posts', topic: 'posts', check: (s) => ((s.scheduledCount ?? 0) + (s.stickyCount ?? 0) > 0 ? [DONE, `${s.scheduledCount ?? 0} scheduled, ${s.stickyCount ?? 0} sticky`] : [OPTIONAL, 'Not used', '/embed send']) },
    { id: 'growth', group: 'Community', title: 'Invites, sticky roles & counters', topic: 'growth', check: (s) => {
        const on = [s.invitesOn && 'invite tracking', s.stickyRolesOn && 'sticky roles', (s.counterCount ?? 0) > 0 && `${s.counterCount} counter${s.counterCount === 1 ? '' : 's'}`].filter(Boolean);
        return on.length ? [DONE, on.join(', ')] : [OPTIONAL, 'Not used', '/invites enable'];
    } },
    { id: 'access', group: 'Community', title: 'Command rules', topic: 'access', check: (s) => ((s.ruleCount ?? 0) > 0 ? [DONE, `${s.ruleCount} rule${s.ruleCount === 1 ? '' : 's'}`] : [OPTIONAL, 'Not used (every command works for everyone it is meant for)', '/commandrules list']) },
    { id: 'escalation', group: 'Protection', title: 'Warn escalation', topic: 'escalation', check: (s) => (s.escalationOn ? [DONE, `${s.escalationRules} rule${s.escalationRules === 1 ? '' : 's'}`] : [OPTIONAL, 'Off', '/warnescalation add']) },
    { id: 'modmail', group: 'Staff tools', title: 'Modmail', topic: 'modmail', check: (s) => (s.modmailCfg?.enabled ? [DONE, `On, ${s.modmailOpen ?? 0} open`] : [OPTIONAL, 'Off', '/modmail setup']) },
    { id: 'voicetime', group: 'Community', title: 'Voice time stats', topic: 'voicetime', check: (s) => (s.voiceTimeOn ? [DONE, 'Counting voice time'] : [OPTIONAL, 'Off', '/voicetime enable']) },
    { id: 'counting', group: 'Fun', title: 'Counting channel', topic: 'fun', check: (s) => (s.counting?.channelId ? [DONE, `In ${ch(s.counting.channelId)}, record ${s.counting.record ?? 0}`] : [OPTIONAL, 'Not used', '/counting setup channel:#counting']) },
    { id: 'birthdays', group: 'Fun', title: 'Birthdays', topic: 'fun', check: (s) => (s.birthdays?.channelId ? [DONE, `Announced in ${ch(s.birthdays.channelId)}`] : [OPTIONAL, 'Not used', '/birthday channel channel:#birthdays']) },
    { id: 'bump', group: 'Fun', title: 'Bump reminders', topic: 'fun', check: (s) => (s.bump?.channelId ? [DONE, `Reminders in ${ch(s.bump.channelId)}`] : [OPTIONAL, 'Not used', '/bump setup channel:#bump']) },
    { id: 'games', group: 'Fun', title: 'Games', topic: 'fun', check: (s) => (s.funConfig?.gamesEnabled === false ? [OPTIONAL, 'Switched off', '/fun games enabled:true'] : [DONE, s.funConfig?.gamesChannelId ? `On, only in ${ch(s.funConfig.gamesChannelId)}` : 'On in every channel', '/fun games channel:#games'])},
];

// Returns { items: [{ id, group, title, state, icon, summary, next, essential, topic }], essentials: { done, total } }
function evaluate(snap) {
    const items = SYSTEMS.map((sys) => {
        const [state, summary, next = null] = sys.check(snap);
        return { id: sys.id, group: sys.group, title: sys.title, state, icon: ICON[state], summary, next, essential: Boolean(sys.essential), topic: sys.topic };
    });
    const essential = items.filter((i) => i.essential);
    return { items, essentials: { done: essential.filter((i) => i.state === DONE).length, total: essential.length } };
}

const progressBar = (done, total, width = 10) => { const n = total ? Math.round((done / total) * width) : 0; return '▰'.repeat(n) + '▱'.repeat(width - n); };

module.exports = { snapshot, evaluate, progressBar, SYSTEMS, ICON };
