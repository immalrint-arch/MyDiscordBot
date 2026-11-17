# Incomu commands

Incomu has **89 slash commands** in 24 groups. This file is generated from the `/help` catalog: do not edit it by hand, run `node scripts/generate-docs.js` instead.

Inside Discord, `/help` shows the same information with more detail, and `/setup` walks you through turning things on.

## Groups

- ⚖️ **Moderation**: `/ban`, `/unban`, `/softban`, `/kick`, `/timeout`, `/untimeout`, `/warn`, `/unwarn`, `/massban`, `/quarantine`, `/warnescalation`, `/banlist`
- 🗂️ **Cases & history**: `/case`, `/warnings`, `/modlogs`, `/modstats`, `/reason`, `/note`, `/report`, `/reportconfig`
- 🧹 **Channel & member tools**: `/purge`, `/slowmode`, `/lock`, `/unlock`, `/lockdown`, `/unlockdown`, `/nick`, `/sanitize`, `/vc`
- 🤖 **Auto-moderation**: `/automod`
- 💾 **Server backup & restore**: `/serverbackup`
- ❓ **Question of the Day**: `/qotd`
- 🚨 **Raid mode**: `/raidmode`
- 🛡️ **Anti-nuke**: `/antinuke`
- 📜 **Logging & settings**: `/logs`, `/settings`, `/textcommands`
- ✅ **Verification**: `/verification`
- 🎫 **Tickets**: `/ticket`, `/modmail`
- 👋 **Welcome & goodbye**: `/welcome`, `/goodbye`
- 🎭 **Roles**: `/role`, `/rolepanel`, `/autorole`
- 🧱 **Channels & voice**: `/channel`, `/template`, `/tempvoice`, `/voice`
- ⭐ **Leveling**: `/level`, `/levelrole`, `/xp`, `/rank`, `/leaderboard`, `/voicetime`
- 🎉 **Giveaways & events**: `/giveaway`, `/event`
- 💬 **Community**: `/confess`, `/confession`, `/suggest`, `/suggestion`, `/starboard`, `/poll`, `/quote`
- 🎮 **Games**: `/play`
- 🎈 **Fun & social**: `/birthday`, `/afk`, `/counting`, `/bump`, `/fun`, `/random`
- 🏷️ **Custom Commands & Auto-replies**: `/tag`, `/autoresponder`
- 📣 **Announcements & Scheduled Posts**: `/embed`, `/schedule`, `/sticky`
- 📈 **Growth & Members**: `/invites`, `/stickyroles`, `/membercount`
- 🧰 **Bot Info & Command Rules**: `/commandrules`, `/botinfo`, `/owner`
- 🧰 **Utility**: `/remind`, `/userinfo`, `/serverinfo`, `/avatar`, `/help`, `/setup`, `/ping`

## ⚖️ Moderation

Punish and remove rule-breakers: bans, kicks, timeouts (mutes), warnings, quarantine.

### /ban

```
/ban add user:@Spammer reason:Posting scam links
/ban add user:@Troll duration:7d reason:Cool-off
/ban add user:@Bot soft:true  (ban + unban to wipe messages)
```

> Moderators need the Ban Members permission, and the bot's role must be ABOVE the person you ban.

### /unban

```
/unban user_id:123456789012345678 reason:Appeal accepted
```

### /softban

### /kick

```
/kick user:@Someone reason:Please rejoin when you are ready
```

### /timeout

```
/timeout user:@Someone duration:1h reason:Cool down
```

> A timeout is a mute: the member cannot chat, react or speak. Maximum 28 days (Discord rule).

### /untimeout

### /warn

```
/warn user:@Someone reason:No advertising
```

### /unwarn

### /massban

```
/massban ids:123456789012345678 234567890123456789 reason:Raid
```

### /quarantine

```
/quarantine add user:@Hacked reason:Account was compromised
/quarantine remove user:@Hacked
```

> Run /setup (Quick setup) once to create the quarantine role and its safe channel.

### /warnescalation

```
/warnescalation add warnings:3 action:timeout minutes:60
/warnescalation add warnings:5 action:ban
/warnescalation toggle enabled:true
/warnescalation window days:30
/warnescalation list
/warnescalation remove warnings:3
```

> Pardoned warnings (/unwarn) do not count. Use /warnescalation window to only count recent warnings. The automatic action is saved as a case by me and appears in the mod log.

### /banlist

```
/banlist export
/banlist import file:banlist.csv reason:Known raiders
/banlist copy server:123456789012345678 reason:Same community
```

> Export gives you a private file; keep it safe. Import and copy always show a preview with Confirm and Cancel first, and skip people who are already banned. Slash command only (it needs a file).

## 🗂️ Cases & history

Look up what happened: every action is a numbered case. Also member reports and staff statistics.

### /case

```
/case number:12
```

### /warnings

### /modlogs

```
/modlogs user:@Someone
```

### /modstats

### /reason

### /note

### /report

```
/report user:@Someone reason:Harassing me in DMs
```

### /reportconfig

## 🧹 Channel & member tools

Clean up and control: delete messages, slowmode, lock channels or the whole server, fix nicknames, voice moderation.

### /purge

```
/purge amount:50
/purge amount:100 user:@Spammer
```

### /slowmode

```
/slowmode seconds:10
```

### /lock

### /unlock

### /lockdown

```
/lockdown reason:Raid in progress
```

### /unlockdown

### /nick

### /sanitize

### /vc

## 🤖 Auto-moderation

The bot watches chat by itself: spam, invites, bad words, caps, mass mentions... and acts automatically.

### /automod

```
/automod enable
/automod rule rule:invites enabled:true action:delete
```

> Auto-moderation never touches moderators/exempt roles. Add exemptions with /automod exempt-add.

## 💾 Server backup & restore

Saves your roles, channels and permissions, and puts back whatever is missing after a disaster.

### /serverbackup

```
/serverbackup create name:Before the big change
/serverbackup list
/serverbackup info id:1
/serverbackup restore id:1
/serverbackup restore id:1 fix_existing:true
/serverbackup auto days:7
/serverbackup delete id:1
```

> Administrator only. A backup holds roles, channels, categories and their permissions, not messages or members. Restore never deletes anything. I need Manage Roles and Manage Channels, and my role must be high up the role list.

## ❓ Question of the Day

A new conversation starter posted every day with a thread for answers. Use your own questions or the built-in ones.

### /qotd

```
/qotd setup channel:#qotd time:18:00 utc_offset:8
/qotd setup channel:#qotd role:@QOTD threads:false
/qotd add question:What is your favourite way to relax?
/qotd list
/qotd remove id:3
/qotd post
/qotd status
/qotd disable
```

> Your own questions are asked first (each once), then the built-in ones, with no repeats until everything was used. Time zone is hours from UTC (8 = UTC+8). Needs Send Messages and Create Public Threads in the channel.

## 🚨 Raid mode

Notices many accounts joining at once, locks things down, warns staff, and puts everything back afterwards.

### /raidmode

```
/raidmode setup joins:10 seconds:30 action:timeout alert_channel:#staff-alerts
/raidmode setup alert_role:@Moderators duration:20
/raidmode status
/raidmode start
/raidmode end
/raidmode disable
```

> Needs Manage Server (verification level, pause invites) and Kick/Moderate Members for the kick/timeout actions. The Pause Invites feature needs a recent discord.js.

## 🛡️ Anti-nuke

Protects the server from hacked admins or rogue bots deleting channels, roles or banning people.

### /antinuke

```
/antinuke enable
/antinuke trust-add user:@MyOtherAdmin
/antinuke alert-channel channel:#mod-log
```

> Run /antinuke trust-add for your own other admins/bots first, or the bot may stop them by mistake.

## 📜 Logging & settings

Where logs go, the ban-appeal channel, and typing commands like !ban.

### /logs

```
/logs set-all channel:#mod-log
/logs set category:messages channel:#message-log
```

### /settings

### /textcommands

```
/textcommands enable
/textcommands prefix prefix:?
/textcommands alias-add alias:b command:ban
```

> Text commands are OFF until you run /textcommands enable.

## ✅ Verification

New members must solve a captcha before they can see the server (stops raid bots).

### /verification

```
/verification role role:@Verified
/verification panel channel:#verify
/verification enable
```

## 🎫 Tickets

Private support channels opened with a button, with staff tools, transcripts and ratings.

### /ticket

```
/ticket category category:Support
/ticket panel channel:#support
/ticket enable
```

### /modmail

```
/modmail setup category:#Support staff_role:@Staff log_channel:#modmail-logs
/modmail status
/modmail close reason:Solved
/modmail block user:@Sam reason:Spam
/modmail unblock user:@Sam
/modmail blocked
```

> Members send the bot a DM; staff answer in a private channel. Start a staff message with // for a private note that is not sent. Needs Manage Channels for me in the category.

## 👋 Welcome & goodbye

Greet people who join and say goodbye to people who leave, with fully editable messages.

### /welcome

```
/welcome channel channel:#welcome
/welcome enable
```

### /goodbye

## 🎭 Roles

Give roles automatically, let members pick roles from a panel, or give temporary roles.

### /role

### /rolepanel

```
/rolepanel create name:colors type:button
/rolepanel add-role panel:colors role:@Red label:Red
/rolepanel publish panel:colors channel:#roles
```

> Create the panel, add roles to it, then publish it into a channel.

### /autorole

```
/autorole add role:@Member who:humans when:join
```

## 🧱 Channels & voice

Create and organise channels quickly, save layouts as templates, and temporary voice rooms.

### /channel

### /template

### /tempvoice

```
/tempvoice setup trigger:#Join-to-create
```

### /voice

## ⭐ Leveling

XP for chatting and voice, level-up cards, level roles and leaderboards.

### /level

```
/level enable
/level announce where:current
/level message text:GG {user}, you reached level {level}!
```

### /levelrole

```
/levelrole add level:10 role:@Regular
```

### /xp

### /rank

### /leaderboard

### /voicetime

```
/voicetime enable
/voicetime stats
/voicetime stats user:@Sam
/voicetime top period:weekly
/voicetime top period:monthly previous:true
/voicetime reset user:@Sam
```

> Counts minutes in voice channels (not while deafened, not in the AFK channel, never bots), even when you are alone. This is separate from voice XP.

## 🎉 Giveaways & events

Run giveaways with requirements and schedule server events with reminders.

### /giveaway

```
/giveaway start prize:Nitro duration:2d winners:1
```

> Winners are drawn again with /giveaway reroll if someone does not claim.

### /event

## 💬 Community

Anonymous confessions, suggestions, starboard, polls and quote pictures.

### /confess

> Slash-only on purpose: a typed !confess would be visible in chat.

### /confession

```
/confession setup channel:#confessions
```

### /suggest

### /suggestion

```
/suggestion setup channel:#suggestions
/suggestion approve number:3 note:Coming soon!
```

### /starboard

```
/starboard setup channel:#starboard stars:3
```

### /poll

```
/poll create question:Best food? options:Pizza | Tacos | Burgers duration:1d
```

### /quote

```
/quote create message:https://discord.com/channels/...
```

## 🎮 Games

Play in the chat with buttons: trivia, rock-paper-scissors, tic-tac-toe, Connect Four, guessing games, truth or dare.

### /play

```
/play trivia category:science difficulty:hard
/play rps opponent:@Friend
/play tictactoe opponent:@Friend
/play connect4 opponent:@Friend
/play guess-number max:500
/play hangman
/play truth-or-dare type:dare
/play stats
/play stats game:trivia
```

> Trivia: the first correct answer wins. Wrong answers lock you out of that question. Questions are built in, so it works offline.

## 🎈 Fun & social

Birthdays, AFK status, a counting channel, bump reminders, and quick fun commands (8-ball, dice, ship, hugs).

### /birthday

```
/birthday set month:March day:14 utc-offset:8
/birthday channel channel:#birthdays
/birthday role role:@Birthday
```

> Add your time zone with utc-offset (for example 8 for UTC+8) so your birthday starts on your own morning.

### /afk

```
/afk reason:Dinner, back in 30 minutes
```

### /counting

```
/counting setup channel:#counting
/counting stats
```

> Members count 1, 2, 3 in the channel. The same person cannot count twice in a row, and a wrong number restarts at 1.

### /bump

```
/bump setup channel:#bump role:@Bumpers
```

> Works with DISBOARD: when it says "Bump done", I remind you again after 2 hours.

### /fun

```
/fun games enabled:true channel:#games
/fun status
```

### /random

```
/random dice roll:2d20+3
/random 8ball question:Will it rain tomorrow?
/random choose options:pizza, burgers, tacos
/random ship user:@Alex other:@Sam
/random rate thing:my new profile picture
/random action type:hug user:@Friend
```

## 🏷️ Custom Commands & Auto-replies

Make your own commands like !rules or !ip, and replies that fire when someone says certain words.

### /tag

```
/tag create name:rules response:Please read #rules, {user}!
/tag use name:rules
/tag list
/tag delete name:rules
```

> Names cannot match built-in commands. In the reply you can use {user} {username} {server} {channel} {members} and {args}.

### /autoresponder

```
/autoresponder add trigger:server ip response:The IP is play.example.com match:contains
/autoresponder list
/autoresponder test text:what is the server ip
/autoresponder toggle id:1 enabled:false
```

> Use /autoresponder test to check a message before people see it. Auto-replies never ping anyone.

## 📣 Announcements & Scheduled Posts

Send nice embeds, schedule posts for later or on repeat, and keep a message stuck at the bottom of a channel.

### /embed

```
/embed send channel:#announcements title:Server update description:We have new channels!\nCheck them out. color:green
/embed form channel:#announcements
/embed edit message_link:https://discord.com/channels/123456789012345678/123456789012345678/123456789012345678 title:New title
```

> Use /embed form for a long announcement. Colours: a hex code like #5865F2 or a name (red, green, blue, gold...). Only the role you choose is pinged, never @everyone.

### /schedule

```
/schedule add channel:#general when:2h message:Event starts soon!
/schedule add channel:#news when:2026-12-25 09:00 utc-offset:8 title:Merry Christmas description:Have a great day!
/schedule add channel:#general when:1d repeat:1d times:7 message:Daily reminder
/schedule list
/schedule toggle id:1 enabled:false
```

> Dates use your time zone offset: add utc-offset:8 for UTC+8. A repeating post must wait at least 10 minutes between posts.

### /sticky

```
/sticky set channel:#rules text:Be kind. No spam.\nAsk staff if unsure. title:Read first
/sticky list
/sticky remove channel:#rules
```

> A sticky message moves to the bottom a few seconds after people chat, so it is always the last message.

## 📈 Growth & Members

See who invited whom, give roles back to people who rejoin, and show live member numbers in channel names.

### /invites

```
/invites enable
/invites stats
/invites stats user:@Sam
/invites top
/invites who user:@NewMember
```

> I need the Manage Server permission to see invites. Only joins after you turn tracking on are counted. A person who leaves and rejoins counts once.

### /stickyroles

```
/stickyroles enable
/stickyroles status
/stickyroles forget user:@Sam
```

> Roles with staff powers (like Manage Server or Ban Members) and bot roles are never given back automatically. Quarantined members get nothing back.

### /membercount

```
/membercount add channel:#members-counter text:Members: {members}
/membercount add channel:#bots-counter text:Bots: {bots}
/membercount list
/membercount remove channel:#members-counter
```

> Discord only lets a channel be renamed twice every 10 minutes, so the number updates about every 10 minutes. Lock the channel (deny Connect) so it is just a display.

## 🧰 Bot Info & Command Rules

Choose who can use each command and where, see how the bot is doing, and (for the bot owner) backups, a blacklist and error alerts.

### /commandrules

```
/commandrules role command:ban role:@Moderator mode:allow
/commandrules channel command:play channel:#bot-games mode:allow
/commandrules disable command:random
/commandrules enable command:random
/commandrules list
/commandrules clear command:ban
```

> Once you allow one role or channel for a command, everyone else is blocked from it. Administrators are never limited by roles or channels, but a switched-off command is off for everyone. Rules apply to slash and text commands.

### /botinfo

```
/botinfo
```

> Handy to check that the bot is online and how fast it answers.

### /owner

```
/owner backup
/owner blacklist-add user:@Spammer reason:Raiding
/owner blacklist-list
/owner servers
/owner errors-set channel:#bot-errors
/owner errors-test
```

> Only the person who runs the bot can use this. Backups are saved in the data/backups folder and never leave your computer.

## 🧰 Utility

Reminders, member and server info, avatars, and this help.

### /remind

```
/remind add when:30m text:Check the oven
```

### /userinfo

### /serverinfo

### /avatar

### /help

### /setup

### /ping
