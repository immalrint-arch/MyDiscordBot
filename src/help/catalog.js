// The help system builds itself from the REAL command list, so it can never be out of date.
// This file only adds the friendly parts: groups, plain-language blurbs and examples.
const { PermissionFlagsBits } = require('discord.js');

const CATEGORIES = [
    { id: 'moderation', emoji: '⚖️', title: 'Moderation', blurb: 'Punish and remove rule-breakers: bans, kicks, timeouts (mutes), warnings, quarantine.', commands: ['ban', 'unban', 'softban', 'kick', 'timeout', 'untimeout', 'warn', 'unwarn', 'massban', 'quarantine', 'warnescalation', 'banlist'] },
    { id: 'cases', emoji: '🗂️', title: 'Cases & history', blurb: 'Look up what happened: every action is a numbered case. Also member reports and staff statistics.', commands: ['case', 'warnings', 'modlogs', 'modstats', 'reason', 'note', 'report', 'reportconfig'] },
    { id: 'tools', emoji: '🧹', title: 'Channel & member tools', blurb: 'Clean up and control: delete messages, slowmode, lock channels or the whole server, fix nicknames, voice moderation.', commands: ['purge', 'slowmode', 'lock', 'unlock', 'lockdown', 'unlockdown', 'nick', 'sanitize', 'vc'] },
    { id: 'automod', emoji: '🤖', title: 'Auto-moderation', blurb: 'The bot watches chat by itself: spam, invites, bad words, caps, mass mentions... and acts automatically.', commands: ['automod'] },
    { id: 'serverbackup', emoji: '💾', title: 'Server backup & restore', blurb: 'Saves your roles, channels and permissions, and puts back whatever is missing after a disaster.', commands: ['serverbackup'] },
    { id: 'qotd', emoji: '❓', title: 'Question of the Day', blurb: 'A new conversation starter posted every day with a thread for answers. Use your own questions or the built-in ones.', commands: ['qotd'] },
    { id: 'raidmode', emoji: '🚨', title: 'Raid mode', blurb: 'Notices many accounts joining at once, locks things down, warns staff, and puts everything back afterwards.', commands: ['raidmode'] },
    { id: 'antinuke', emoji: '🛡️', title: 'Anti-nuke', blurb: 'Protects the server from hacked admins or rogue bots deleting channels, roles or banning people.', commands: ['antinuke'] },
    { id: 'logging', emoji: '📜', title: 'Logging & settings', blurb: 'Where logs go, the ban-appeal channel, and typing commands like !ban.', commands: ['logs', 'settings', 'textcommands'] },
    { id: 'verification', emoji: '✅', title: 'Verification', blurb: 'New members must solve a captcha before they can see the server (stops raid bots).', commands: ['verification'] },
    { id: 'tickets', emoji: '🎫', title: 'Tickets', blurb: 'Private support channels opened with a button, with staff tools, transcripts and ratings.', commands: ['ticket', 'modmail'] },
    { id: 'welcome', emoji: '👋', title: 'Welcome & goodbye', blurb: 'Greet people who join and say goodbye to people who leave, with fully editable messages.', commands: ['welcome', 'goodbye'] },
    { id: 'roles', emoji: '🎭', title: 'Roles', blurb: 'Give roles automatically, let members pick roles from a panel, or give temporary roles.', commands: ['role', 'rolepanel', 'autorole'] },
    { id: 'channels', emoji: '🧱', title: 'Channels & voice', blurb: 'Create and organise channels quickly, save layouts as templates, and temporary voice rooms.', commands: ['channel', 'template', 'tempvoice', 'voice'] },
    { id: 'leveling', emoji: '⭐', title: 'Leveling', blurb: 'XP for chatting and voice, level-up cards, level roles and leaderboards.', commands: ['level', 'levelrole', 'xp', 'rank', 'leaderboard', 'voicetime'] },
    { id: 'events', emoji: '🎉', title: 'Giveaways & events', blurb: 'Run giveaways with requirements and schedule server events with reminders.', commands: ['giveaway', 'event'] },
    { id: 'community', emoji: '💬', title: 'Community', blurb: 'Anonymous confessions, suggestions, starboard, polls and quote pictures.', commands: ['confess', 'confession', 'suggest', 'suggestion', 'starboard', 'poll', 'quote'] },
    { id: 'games', emoji: '🎮', title: 'Games', blurb: 'Play in the chat with buttons: trivia, rock-paper-scissors, tic-tac-toe, Connect Four, guessing games, truth or dare.', commands: ['play'] },
    { id: 'fun', emoji: '🎈', title: 'Fun & social', blurb: 'Birthdays, AFK status, a counting channel, bump reminders, and quick fun commands (8-ball, dice, ship, hugs).', commands: ['birthday', 'afk', 'counting', 'bump', 'fun', 'random'] },
    { id: 'custom', emoji: '🏷️', title: 'Custom Commands & Auto-replies', blurb: 'Make your own commands like !rules or !ip, and replies that fire when someone says certain words.', commands: ['tag', 'autoresponder'] },
    { id: 'posts', emoji: '📣', title: 'Announcements & Scheduled Posts', blurb: 'Send nice embeds, schedule posts for later or on repeat, and keep a message stuck at the bottom of a channel.', commands: ['embed', 'schedule', 'sticky'] },
    { id: 'growth', emoji: '📈', title: 'Growth & Members', blurb: 'See who invited whom, give roles back to people who rejoin, and show live member numbers in channel names.', commands: ['invites', 'stickyroles', 'membercount'] },
    { id: 'tools', emoji: '🧰', title: 'Bot Info & Command Rules', blurb: 'Choose who can use each command and where, see how the bot is doing, and (for the bot owner) backups, a blacklist and error alerts.', commands: ['commandrules', 'botinfo', 'owner'] },
    { id: 'utility', emoji: '🧰', title: 'Utility', blurb: 'Reminders, member and server info, avatars, and this help.', commands: ['remind', 'userinfo', 'serverinfo', 'avatar', 'help', 'setup', 'ping'] },
];
const OTHER = { id: 'other', emoji: '📦', title: 'Other', blurb: 'More commands.', commands: [] };

// Short examples people can copy. (Checked by a test: every command and option named here must really exist.)
const EXAMPLES = {
    ban: ['/ban add user:@Spammer reason:Posting scam links', '/ban add user:@Troll duration:7d reason:Cool-off', '/ban add user:@Bot soft:true  (ban + unban to wipe messages)'],
    unban: ['/unban user_id:123456789012345678 reason:Appeal accepted'],
    kick: ['/kick user:@Someone reason:Please rejoin when you are ready'],
    timeout: ['/timeout user:@Someone duration:1h reason:Cool down'],
    warn: ['/warn user:@Someone reason:No advertising'],
    purge: ['/purge amount:50', '/purge amount:100 user:@Spammer'],
    quarantine: ['/quarantine add user:@Hacked reason:Account was compromised', '/quarantine remove user:@Hacked'],
    massban: ['/massban ids:123456789012345678 234567890123456789 reason:Raid'],
    case: ['/case number:12'],
    modlogs: ['/modlogs user:@Someone'],
    slowmode: ['/slowmode seconds:10'],
    lockdown: ['/lockdown reason:Raid in progress'],
    report: ['/report user:@Someone reason:Harassing me in DMs'],
    giveaway: ['/giveaway start prize:Nitro duration:2d winners:1'],
    remind: ['/remind add when:30m text:Check the oven'],
    poll: ['/poll create question:Best food? options:Pizza | Tacos | Burgers duration:1d'],
    rolepanel: ['/rolepanel create name:colors type:button', '/rolepanel add-role panel:colors role:@Red label:Red', '/rolepanel publish panel:colors channel:#roles'],
    autorole: ['/autorole add role:@Member who:humans when:join'],
    welcome: ['/welcome channel channel:#welcome', '/welcome enable'],
    ticket: ['/ticket category category:Support', '/ticket panel channel:#support', '/ticket enable'],
    verification: ['/verification role role:@Verified', '/verification panel channel:#verify', '/verification enable'],
    antinuke: ['/antinuke enable', '/antinuke trust-add user:@MyOtherAdmin', '/antinuke alert-channel channel:#mod-log'],
    automod: ['/automod enable', '/automod rule rule:invites enabled:true action:delete'],
    logs: ['/logs set-all channel:#mod-log', '/logs set category:messages channel:#message-log'],
    level: ['/level enable', '/level announce where:current', '/level message text:GG {user}, you reached level {level}!'],
    levelrole: ['/levelrole add level:10 role:@Regular'],
    confession: ['/confession setup channel:#confessions'],
    suggestion: ['/suggestion setup channel:#suggestions', '/suggestion approve number:3 note:Coming soon!'],
    starboard: ['/starboard setup channel:#starboard stars:3'],
    textcommands: ['/textcommands enable', '/textcommands prefix prefix:?', '/textcommands alias-add alias:b command:ban'],
    quote: ['/quote create message:https://discord.com/channels/...'],
    tempvoice: ['/tempvoice setup trigger:#Join-to-create'],
    play: ['/play trivia category:science difficulty:hard', '/play rps opponent:@Friend', '/play tictactoe opponent:@Friend', '/play connect4 opponent:@Friend', '/play guess-number max:500', '/play hangman', '/play truth-or-dare type:dare', '/play stats', '/play stats game:trivia'],
    birthday: ['/birthday set month:March day:14 utc-offset:8', '/birthday channel channel:#birthdays', '/birthday role role:@Birthday'],
    afk: ['/afk reason:Dinner, back in 30 minutes'],
    counting: ['/counting setup channel:#counting', '/counting stats'],
    bump: ['/bump setup channel:#bump role:@Bumpers'],
    fun: ['/fun games enabled:true channel:#games', '/fun status'],
    modmail: ['/modmail setup category:#Support staff_role:@Staff log_channel:#modmail-logs', '/modmail status', '/modmail close reason:Solved', '/modmail block user:@Sam reason:Spam', '/modmail unblock user:@Sam', '/modmail blocked'],
    raidmode: ['/raidmode setup joins:10 seconds:30 action:timeout alert_channel:#staff-alerts', '/raidmode setup alert_role:@Moderators duration:20', '/raidmode status', '/raidmode start', '/raidmode end', '/raidmode disable'],
    serverbackup: ['/serverbackup create name:Before the big change', '/serverbackup list', '/serverbackup info id:1', '/serverbackup restore id:1', '/serverbackup restore id:1 fix_existing:true', '/serverbackup auto days:7', '/serverbackup delete id:1'],
    qotd: ['/qotd setup channel:#qotd time:18:00 utc_offset:8', '/qotd setup channel:#qotd role:@QOTD threads:false', '/qotd add question:What is your favourite way to relax?', '/qotd list', '/qotd remove id:3', '/qotd post', '/qotd status', '/qotd disable'],
    voicetime: ['/voicetime enable', '/voicetime stats', '/voicetime stats user:@Sam', '/voicetime top period:weekly', '/voicetime top period:monthly previous:true', '/voicetime reset user:@Sam'],
    warnescalation: ['/warnescalation add warnings:3 action:timeout minutes:60', '/warnescalation add warnings:5 action:ban', '/warnescalation toggle enabled:true', '/warnescalation window days:30', '/warnescalation list', '/warnescalation remove warnings:3'],
    banlist: ['/banlist export', '/banlist import file:banlist.csv reason:Known raiders', '/banlist copy server:123456789012345678 reason:Same community'],
    commandrules: ['/commandrules role command:ban role:@Moderator mode:allow', '/commandrules channel command:play channel:#bot-games mode:allow', '/commandrules disable command:random', '/commandrules enable command:random', '/commandrules list', '/commandrules clear command:ban'],
    botinfo: ['/botinfo'],
    owner: ['/owner backup', '/owner blacklist-add user:@Spammer reason:Raiding', '/owner blacklist-list', '/owner servers', '/owner errors-set channel:#bot-errors', '/owner errors-test'],
    invites: ['/invites enable', '/invites stats', '/invites stats user:@Sam', '/invites top', '/invites who user:@NewMember'],
    stickyroles: ['/stickyroles enable', '/stickyroles status', '/stickyroles forget user:@Sam'],
    membercount: ['/membercount add channel:#members-counter text:Members: {members}', '/membercount add channel:#bots-counter text:Bots: {bots}', '/membercount list', '/membercount remove channel:#members-counter'],
    embed: ['/embed send channel:#announcements title:Server update description:We have new channels!\\nCheck them out. color:green', '/embed form channel:#announcements', '/embed edit message_link:https://discord.com/channels/123456789012345678/123456789012345678/123456789012345678 title:New title'],
    schedule: ['/schedule add channel:#general when:2h message:Event starts soon!', '/schedule add channel:#news when:2026-12-25 09:00 utc-offset:8 title:Merry Christmas description:Have a great day!', '/schedule add channel:#general when:1d repeat:1d times:7 message:Daily reminder', '/schedule list', '/schedule toggle id:1 enabled:false'],
    sticky: ['/sticky set channel:#rules text:Be kind. No spam.\\nAsk staff if unsure. title:Read first', '/sticky list', '/sticky remove channel:#rules'],
    tag: ['/tag create name:rules response:Please read #rules, {user}!', '/tag use name:rules', '/tag list', '/tag delete name:rules'],
    autoresponder: ['/autoresponder add trigger:server ip response:The IP is play.example.com match:contains', '/autoresponder list', '/autoresponder test text:what is the server ip', '/autoresponder toggle id:1 enabled:false'],
    random: ['/random dice roll:2d20+3', '/random 8ball question:Will it rain tomorrow?', '/random choose options:pizza, burgers, tacos', '/random ship user:@Alex other:@Sam', '/random rate thing:my new profile picture', '/random action type:hug user:@Friend'],
};

const TIPS = {
    ban: 'Moderators need the Ban Members permission, and the bot\'s role must be ABOVE the person you ban.',
    timeout: 'A timeout is a mute: the member cannot chat, react or speak. Maximum 28 days (Discord rule).',
    quarantine: 'Run /setup (Quick setup) once to create the quarantine role and its safe channel.',
    antinuke: 'Run /antinuke trust-add for your own other admins/bots first, or the bot may stop them by mistake.',
    automod: 'Auto-moderation never touches moderators/exempt roles. Add exemptions with /automod exempt-add.',
    confess: 'Slash-only on purpose: a typed !confess would be visible in chat.',
    textcommands: 'Text commands are OFF until you run /textcommands enable.',
    rolepanel: 'Create the panel, add roles to it, then publish it into a channel.',
    play: 'Trivia: the first correct answer wins. Wrong answers lock you out of that question. Questions are built in, so it works offline.',
    counting: 'Members count 1, 2, 3 in the channel. The same person cannot count twice in a row, and a wrong number restarts at 1.',
    birthday: 'Add your time zone with utc-offset (for example 8 for UTC+8) so your birthday starts on your own morning.',
    bump: 'Works with DISBOARD: when it says "Bump done", I remind you again after 2 hours.',
    modmail: 'Members send the bot a DM; staff answer in a private channel. Start a staff message with // for a private note that is not sent. Needs Manage Channels for me in the category.',
    raidmode: 'Needs Manage Server (verification level, pause invites) and Kick/Moderate Members for the kick/timeout actions. The Pause Invites feature needs a recent discord.js.',
    serverbackup: 'Administrator only. A backup holds roles, channels, categories and their permissions, not messages or members. Restore never deletes anything. I need Manage Roles and Manage Channels, and my role must be high up the role list.',
    qotd: 'Your own questions are asked first (each once), then the built-in ones, with no repeats until everything was used. Time zone is hours from UTC (8 = UTC+8). Needs Send Messages and Create Public Threads in the channel.',
    voicetime: 'Counts minutes in voice channels (not while deafened, not in the AFK channel, never bots), even when you are alone. This is separate from voice XP.',
    warnescalation: 'Pardoned warnings (/unwarn) do not count. Use /warnescalation window to only count recent warnings. The automatic action is saved as a case by me and appears in the mod log.',
    banlist: 'Export gives you a private file; keep it safe. Import and copy always show a preview with Confirm and Cancel first, and skip people who are already banned. Slash command only (it needs a file).',
    commandrules: 'Once you allow one role or channel for a command, everyone else is blocked from it. Administrators are never limited by roles or channels, but a switched-off command is off for everyone. Rules apply to slash and text commands.',
    botinfo: 'Handy to check that the bot is online and how fast it answers.',
    owner: 'Only the person who runs the bot can use this. Backups are saved in the data/backups folder and never leave your computer.',
    invites: 'I need the Manage Server permission to see invites. Only joins after you turn tracking on are counted. A person who leaves and rejoins counts once.',
    stickyroles: 'Roles with staff powers (like Manage Server or Ban Members) and bot roles are never given back automatically. Quarantined members get nothing back.',
    membercount: 'Discord only lets a channel be renamed twice every 10 minutes, so the number updates about every 10 minutes. Lock the channel (deny Connect) so it is just a display.',
    embed: 'Use /embed form for a long announcement. Colours: a hex code like #5865F2 or a name (red, green, blue, gold...). Only the role you choose is pinged, never @everyone.',
    schedule: 'Dates use your time zone offset: add utc-offset:8 for UTC+8. A repeating post must wait at least 10 minutes between posts.',
    sticky: 'A sticky message moves to the bottom a few seconds after people chat, so it is always the last message.',
    tag: 'Names cannot match built-in commands. In the reply you can use {user} {username} {server} {channel} {members} and {args}.',
    autoresponder: 'Use /autoresponder test to check a message before people see it. Auto-replies never ping anyone.',
    giveaway: 'Winners are drawn again with /giveaway reroll if someone does not claim.',
};

const PERMISSION_NAMES = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageMessages', 'ManageNicknames', 'ManageEvents',
    'ManageWebhooks', 'ManageThreads', 'ViewAuditLog', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'MentionEveryone', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'CreateInstantInvite'];
const permLabel = (name) => name.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
// default_member_permissions (a number as text) -> "Ban Members, Kick Members". null/"0" -> everyone.
function permissionLabels(mask) {
    if (mask === null || mask === undefined || mask === '0') return [];
    const value = BigInt(mask);
    return PERMISSION_NAMES.filter((name) => PermissionFlagsBits[name] !== undefined && (value & BigInt(PermissionFlagsBits[name])) !== 0n).map(permLabel);
}

// ---- reading the real command definitions ----
const OPTION_TYPES = { 3: 'text', 4: 'whole number', 5: 'yes/no', 6: 'member', 7: 'channel', 8: 'role', 9: 'member or role', 10: 'number', 11: 'file' };

// Turns a command's JSON into { name, description, permissions, subs: [{ name, description, options }], options }
function describeCommand(json) {
    const subs = [];
    const options = [];
    for (const o of json.options ?? []) {
        if (o.type === 1) subs.push({ name: o.name, description: o.description, options: o.options ?? [] });
        else if (o.type === 2) for (const s of o.options ?? []) subs.push({ name: `${o.name} ${s.name}`, description: s.description, options: s.options ?? [] });
        else options.push(o);
    }
    return { name: json.name, description: json.description, permissions: permissionLabels(json.default_member_permissions), subs, options };
}
const optionToken = (o) => (o.required ? `<${o.name}>` : `[${o.name}]`);
const usageLine = (name, sub, options) => `/${name}${sub ? ` ${sub}` : ''}${options.length ? ` ${options.map(optionToken).join(' ')}` : ''}`;

function buildIndex(commandJsons) {
    const byName = new Map(commandJsons.map((j) => [j.name, describeCommand(j)]));
    const placed = new Set();
    const categories = CATEGORIES.map((c) => {
        const commands = c.commands.filter((n) => byName.has(n));
        commands.forEach((n) => placed.add(n));
        return { ...c, commands };
    }).filter((c) => c.commands.length);
    const rest = [...byName.keys()].filter((n) => !placed.has(n)).sort();
    if (rest.length) categories.push({ ...OTHER, commands: rest });
    return { byName, categories };
}

// Words a beginner might type that are not in any command's name.
const SYNONYMS = {
    punish: ['ban', 'kick', 'timeout', 'warn', 'quarantine'], mute: ['timeout', 'vc'], unmute: ['untimeout', 'vc'], remove: ['kick', 'ban', 'purge'], delete: ['purge', 'channel'], clear: ['purge'],
    spam: ['automod', 'purge'], raid: ['raidmode', 'antinuke', 'lockdown', 'verification', 'massban'], hack: ['antinuke', 'quarantine'], hacked: ['antinuke', 'quarantine'], nuke: ['antinuke'],
    captcha: ['verification'], verify: ['verification'], support: ['ticket'], appeal: ['settings', 'ban'], greet: ['welcome'], leave: ['goodbye'], join: ['welcome', 'autorole'],
    xp: ['level', 'xp', 'rank', 'leaderboard'], rank: ['rank', 'leaderboard', 'level'], reaction: ['rolepanel'], color: ['rolepanel'], colour: ['rolepanel'], prefix: ['textcommands'],
    '!': ['textcommands'], suffix: ['textcommands'], vote: ['poll', 'suggestion'], idea: ['suggest', 'suggestion'], anonymous: ['confess', 'confession'], log: ['logs', 'settings'],
    music: [], economy: [], birthday: [], afk: [], invite: ['automod'], badword: ['automod'], words: ['automod'], slow: ['slowmode'], whois: ['userinfo'], profile: ['userinfo', 'avatar'], picture: ['avatar', 'quote'],
};

// ---- search ----
function distance(a, b) {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
}
// Returns { exact: { command, sub } | null, matches: [names] , close: [names] }
function search(index, queryText) {
    const q = String(queryText ?? '').trim().toLowerCase().replace(/^[/!?.]/, '');
    if (!q) return { exact: null, matches: [], close: [] };
    const [first, ...restWords] = q.split(/\s+/);
    const command = index.byName.get(first);
    if (command) {
        const subName = restWords.join(' ');
        const sub = subName ? command.subs.find((s) => s.name === subName || s.name.endsWith(` ${subName}`)) : null;
        if (!subName || sub) return { exact: { command, sub: sub ?? null }, matches: [], close: [] };
    }
    const words = q.split(/\s+/);
    const scored = [];
    for (const [name, c] of index.byName) {
        let score = 0;
        for (const w of words) {
            if (name === w) score += 10; else if (name.startsWith(w)) score += 6; else if (name.includes(w)) score += 4;
            if (c.subs.some((s) => s.name === w)) score += 5; else if (c.subs.some((s) => s.name.includes(w))) score += 2;
            if (c.description.toLowerCase().includes(w)) score += 1;
        }
        for (const w of words) if (SYNONYMS[w]?.includes(name)) score += 8;
        if (score > 0) scored.push([name, score]);
    }
    scored.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const matches = scored.map(([n]) => n).slice(0, 8);
    const close = matches.length ? [] : [...index.byName.keys()].filter((n) => distance(n, first) <= 2).slice(0, 5);
    return { exact: null, matches, close };
}

module.exports = { CATEGORIES, EXAMPLES, TIPS, OPTION_TYPES, describeCommand, buildIndex, search, usageLine, permissionLabels, optionToken };
