# INCOMU — Progress File

Read this first at the start of every session. Verify the real code before trusting the checklist.
Last updated: 2026-11-08 (Milestone 4: logging)

## 1. Current state

- Language/stack: JavaScript (CommonJS), Node.js v24.15.0 on the owner's PC, discord.js v14, dotenv.
- Database: SQLite via Node's built-in `node:sqlite` (no extra package). File: `data/bot.sqlite` (git-ignored).
- Intents in use: Guilds, GuildMembers*, GuildModeration, GuildMessages, MessageContent*, GuildVoiceStates, GuildInvites.
  (*privileged: must be switched ON in Developer Portal > Bot, or login fails with a clear message.)
- Entry point: `index.js` (kept from the original project; loads services, commands, events).
- Owner's environment: Windows, VS Code terminal. Test server only. `.env` holds DISCORD_TOKEN, CLIENT_ID, GUILD_ID (never ask for it).
- Run: `node src/deploy-commands.js` (after any command change), then `node index.js`. Tests: `npm test`.

## 2. Architecture

```
index.js                      entry point, wires services into client.services
src/commands/<category>/      one file per slash command (auto-loaded)
src/events/                   one file per Discord event (auto-loaded)
src/handlers/                 commandHandler, eventHandler
src/services/                 business logic + database access (no Discord code where avoidable)
src/moderation/               hierarchy.js (pure rules), helpers.js, runMemberAction.js (shared engine)
src/database/                 index.js, migrate.js, migrations/NNN_*.sql (never edit old ones)
src/utils/                    logger, getFiles, duration, text, format, embeds (case card), snowflake
src/logging/                  categories, textFormat (pure helpers), style (embed builders), roleCard
tests/                        node:test unit tests
```

Key decisions:
- Services are created in `index.js` and reached as `interaction.client.services.<name>`.
- Every moderation command goes through `runMemberAction` (permission check, hierarchy check,
  DM, Discord action, case saved, log sent). One code path, one place to fix bugs.
- Hierarchy rules live in `src/moderation/hierarchy.js` and are pure functions (unit tested).
- All user text goes through `cleanReason`/`cleanText`; SQL uses prepared statements only.
- Log messages use `allowedMentions: { parse: [] }` so reasons can never ping anyone.
- `node:sqlite` is marked experimental in Node (prints a harmless warning). Revisit if it breaks;
  the services take the db as a parameter, so swapping to better-sqlite3 or PostgreSQL is contained.

## 3. Database schema (migrations applied)

- 001: `guilds`, `guild_settings(log_channel_id)`
- 002: `cases(guild_id, case_number, type, target_id, moderator_id, reason, duration_ms, active, created_at)`
- 003: `guild_settings.dm_on_action`
- 004: `channel_locks(guild_id, channel_id, previous_state, locked_by, locked_at)`
- 005: `log_channels(guild_id, category, channel_id)`, `log_ignores(guild_id, kind, target_id)`

## 4. Verified so far

- Milestone 1 (handler + /ping): works on the owner's server (owner confirmed).
- Milestone 2 (database + /settings): works on the owner's server (owner confirmed).
- Milestone 3 (manual moderation): owner confirmed working on the test server.
- Milestone 4 (logging): 75 unit tests + 3 offline smoke tests pass in the sandbox (Node v22, stub
  discord.js). NOT yet run against real Discord. Owner testing pending. The `-#` small-text footer
  style in embed descriptions is unverified on real Discord; if it shows a literal `-#`, change
  buildDescription() in src/logging/textFormat.js.

## 5. Master feature checklist

Legend: [x] done and tested, [~] written, awaiting live test, [ ] not started

### A1 Manual moderation
- [~] /ban /unban /kick /softban /timeout /untimeout /warn /warnings /unwarn /note /case /modlogs /reason
- [~] /purge /slowmode /lock /unlock /nick
- [~] Case numbers, case history, DM on action (per-server setting), log channel embeds
- [ ] /quarantine /unquarantine /sanitize (needs a quarantine role design, see section 7)
- [ ] /massban (strict safeguards + confirmation) /voice-mute /voice-unmute /voice-deafen /voice-undeafen
- [ ] /role-add /role-remove /role-strip /clearwarnings /hide /unhide /lockdown /unlockdown
- [ ] /channel-cleanup /modstats /report /history (alias of /modlogs?)
- [ ] Confirmation buttons for destructive actions; protected users/roles policy
- [ ] Persist timeouts of /timeout in case history is done; temp-ban (auto unban) not started

### A2 Anti-nuke  [ ] not started
### A3 Auto moderation  [ ] not started
### A4 Logging
- [~] Per-category channels + general fallback + ignore lists (/logs view|set|set-all|clear|ignore|unignore)
- [~] Members: join (+ new-account warning), leave, kick, ban, unban, nickname, roles, timeout, rules accepted
- [~] Roles: create/delete (with permissions)/update. Channels: create/delete/update (incl. permission overwrites)
- [~] Messages: edit, delete, bulk delete. Server: invite create. Voice: join/leave/move/mute/deafen
- [~] Manual moderation case card in reference-image-20 style; no double logging (suppression service)
- [ ] Webhook events, emoji/sticker changes, server settings changes, bot additions (not started)
- [ ] Auto-mod log separation (auto-mod does not exist yet)
- Limits (documented, not bugs): Discord does not say WHO deleted a message; deleted text only shown
  if the message was in memory; audit entries can be late/missing (shown as "Unknown"); channel
  reordering only logged when nothing else changed; members/roles diffs need the member to be cached
  (servers up to 1000 members are preloaded at startup).
### B1 Role management  [x] built in Milestone 8 (awaiting live test)
### B2 Channel management  [x] built in Milestone 8 (awaiting live test)
### B3 Welcome and verification  [x] verification (M7) + welcome/goodbye (M8)
### B4 Tickets  [ ] not started
### C1 Music  [ ] not started (provider decision pending, see section 7)
### C2 Leveling  [x] built in Milestone 9 (awaiting live test)
### C3 Fun and games  [ ] not started
### C4 Confessions  [ ] not started
### D1 Utility  [~] /quote (picture quotes) built in M8; rest not started
### D2 Giveaways and events  [x] built in Milestone 10 (awaiting live test)
### E1 /help (auto-generated from registered commands)  [ ] not started
### E2 /setup (interactive)  [ ] not started
### E3 Text commands (configurable trigger)  [x] built in Milestone 11 (awaiting live testing)
### Additional researched features  [ ] not started (see section 6)
### Docs: README, INSTALLATION, CONFIGURATION, COMMANDS, DATABASE, SECURITY, CHANGELOG, DEVELOPMENT  [ ] not started
### Dashboard (original goal)  [ ] not started

## 6. Recommended additional features (not built yet)

Starboard, suggestions, custom commands, scheduled messages, server config snapshots/backups,
role-hierarchy inspector, staff activity stats, member reports, sticky messages, auto-publish,
per-command cooldown config, invite tracking, ghost-ping detection, temp-ban, mod-action
approvals for dangerous operations, health/status page.

## 6b. Milestone 5: Anti-nuke (built, awaiting live testing by the owner)

- `/antinuke enable|disable` (owner-only), plus status, mode (alert|contain), sensitivity, alert-channel,
  threshold / threshold-reset, trust-add / trust-remove / trust-list, safemode, incidents, simulate.
  Admins may only view (status, trust-list, incidents, simulate). OFF by default.
- Also `/lockdown` (confirm buttons) and `/unlockdown`. Schema migration 006.
- Rules: channel/role delete+create, member ban/kick, webhook create, dangerous permission grant, bot add.
- Containment is reversible (roles removed + remembered; Restore gives back), only for high severity in
  contain/safe mode, never for owner/self/trusted/unknown. Never auto-ban/kick.
- Recovery recreates deleted channels/roles from saved structure (14-day retention, no message history).
- Tests: 87 unit tests + offline scenario smoke test (fake Discord objects; not real Discord).
- NOT yet verified on real Discord: audit-log timing, button flow, containment, recovery, lockdown.
- `/automod enable|disable` will be added with the auto-moderation milestone.
- Note: add ticket bots as trusted (`/antinuke trust-add`) or their channel deletions will alert.

## 6c. Milestone 6: moderation message redesign, ban appeals, tickets (built, awaiting live testing)

- Owner decision: the bot never sends "only you can see this" replies. Every reply is public in the channel where the
  command was used (the moderation channel is staff-only). Exception: the ticket panel's "your ticket is ready" and
  limit/error replies are private, because the panel sits in a public channel.
- DM to the target (reference image 1) for ban, kick, softban, warn, timeout. Bans include an "Appeal ban" button.
- `/ban add` (user, reason, dm, duration, proof, hack, soft, purge_days). `hack: True` is required to ban someone who is
  not in the server. Timed bans are lifted by a 30-second scheduler (also catches bans that expired while offline).
- Public result messages: "Ban/Kick/Warn/Timeout Result:" (image 3) and "Unban/Untimeout/Unwarn result:" (image 5).
  `/unban` accepts up to 10 IDs. Only manual commands send these; auto-mod and anti-nuke never will.
- Appeals (image 4): button in the DM opens a form; the appeal card with Approve / Deny / Deny + Blacklist / Dismiss goes
  to the appeal channel (`/settings set-appeal-channel`, falls back to the moderation log channel). Only people who are
  banned right now can appeal; one pending appeal each; moderators need Ban Members (re-checked on click).
- Tickets: `/ticket enable|disable|category|log-channel|staff-add|staff-remove|max-open|ratings|panel|status`, and inside a
  ticket `/ticket close|claim|add|remove|rename|transcript`. Panel button -> form -> private channel (opener + staff roles
  + bot only) -> Claim / Close buttons -> HTML transcript to the log channel and the opener's DMs -> 1-5 star rating.
- Schema: migrations 007 (proof_url, appeal_channel_id, ban_appeals, appeal_blacklist, temp_bans) and 008 (tickets).
- Tests: 95 unit tests + offline flow smoke tests (fake Discord objects, not real Discord).
- Known limits: Discord attachment links used as proof can expire after a while; ticket reference images 5-9 were not
  re-checked in this session, so the ticket look is a clean neutral design to be adjusted to them.

## 6d. Milestone 7: ticket display, captcha verification, auto-moderation (built, awaiting live testing)

- Tickets redesigned to the owner's reference images: green "Ticket / Create ticket" panel; ticket opens immediately
  (optional subject form via ask_form); welcome line + staff call (editable defaults) + green box + Close/Claim buttons;
  Close asks "Are you sure?"; closing keeps the channel, shows "Ticket Closed by" and staff controls
  Transcript / Open / Delete. Owner confirmed the ticket look is fine: no further changes requested.
- Verification: `/verification status|enable|disable|role|unverified-role|attempts|panel`. Panel matches reference image 5
  (Verify + Help). Verify -> private captcha picture (generated in pure Node, no packages) -> Enter code form.
  5 characters, no confusing letters, code valid 5 min, a wrong answer destroys the code, lockout 10 min after N wrong
  answers, "New code" limited to 5 per 10 min. Verified role must be harmless (no admin-type permissions) and below the bot.
  Replies are private (panel is public). Captcha state is in memory (restart = press Verify again).
- Auto-moderation: `/automod status|enable|disable|rule|rule-reset|list-add|list-remove|list-show|exempt-add|exempt-remove|
  exempt-list|punishment|strikes|clear-strikes|stats`. Off by default. Rules: spam, duplicates, mass mentions, invites,
  links (off), banned words, smart caps (squashes repeated letters, so "WHATTTTTT" is fine), emoji spam (off),
  suspicious new accounts (off). Strikes escalate to a timeout. Staff (Administrator/Manage Server/Manage Messages/
  Timeout Members), the owner, bots and exemptions are ignored. Edited messages are checked too.
- Auto-mod is fully separate from manual moderation: own database tables, no cases, own log category `automod`
  (`/logs set category:automod`; `/logs set-all` deliberately skips it).
- Schema: migrations 009 (ticket display + verification_config) and 010 (log_channels rebuilt with 'automod', automod tables).
- Tests: 110 unit tests + offline flow smoke tests (fake Discord objects, not real Discord).
- NOT yet verified on real Discord: how the captcha picture looks in Discord, modal/button behaviour, delete/timeout permissions.

## 6e. Milestone 8: quotes, roles, channels, welcome/goodbye (built, awaiting live testing)

Migration `011_quotes_roles_channels_welcome.sql` (tables: quote_config, role_panels, role_panel_options, auto_roles,
temp_roles, channel_templates, tempvoice_config, tempvoice_channels, welcome_config). Services: quotes, roles, channels, welcome.

- **Quotes**: reply to a message and ping the bot (add `light` or `color` after the ping) OR `/quote create message:<link or ID>`.
  `/quote enable|disable|reply-trigger|status` (Manage Server). Needs the optional package `@napi-rs/canvas`
  (`npm install @napi-rs/canvas`); without it the bot falls back to a plain embed quote. 6 second cooldown per person.
  Files: `src/quotes/*`, `src/events/quotes/quoteReply.js`, `src/commands/utility/quote.js`.
- **Roles**: `/rolepanel` (button, dropdown, reaction panels; max roles, required role, no-removal option),
  `/autorole` (on join or after verification; people/bots/all), `/role add|remove|temp|temp-list|strip`.
  Roles with powerful permissions (anti-nuke list) cannot go on panels or automatic roles. Panel buttons answer privately
  to the clicker (public-channel flow). Temporary roles expire via a 30 second scheduler (also catches ones that expired while offline).
  Reaction roles need the Message Reactions intent (added, not privileged).
  Role changes are logged by the existing member log, not twice.
- **Channels**: `/channel create|edit|clone|delete|hide|show|sync|cleanup` (delete and cleanup need a button confirm; rules/updates/system channels refused),
  `/template save|apply|list|delete` (stores names/types/topics only, never permissions), `/tempvoice setup|enable|disable|status`,
  `/voice rename|limit|lock|unlock|transfer|claim` for room owners.
- **Welcome/goodbye**: `/welcome` and `/goodbye` with enable, disable, channel, message, title, style (embed/text/card), color, footer,
  banner, delete-after, bots, test, placeholders, status, reset; `/welcome` also ping, timing (join or after verification), dm.
  Placeholders: {user} {username} {displayname} {userid} {server} {count} {ordinal} {created} {joined} {rules}.
  Verification now emits `incomuMemberVerified` so "after verification" welcome and automatic roles work.
- Quote fix (after M9): buttons under the picture like "Make it a Quote" (light/dark, colour, bold, remove my quote); startup warning and `/quote status` show why pictures are off (usually `npm install @napi-rs/canvas` was not run). Reply trigger also accepts the word `bold`.
- Not built (reserved): level-reward roles (leveling milestone), new-account notice in the welcome message, panel name autocomplete.
- Tests: 135 unit tests pass. Offline flow checks used fake Discord objects and a stand-in for discord.js (not the real library).

## 6f. Milestone 9: anti-nuke alert role + leveling (built, awaiting live testing)

Migration `012_antinuke_alert_role_and_leveling.sql` (antinuke_config.alert_role_id; level_config, level_users, level_daily,
level_roles, level_ignores, level_boosts). Service: levels. Pure maths: `src/leveling/xpMath.js` (level n needs 5n^2+50n+100 XP).

- **Anti-nuke alert ping (optional)**: `/antinuke alert-role role:@Role` (owner only); run it without a role to clear. Never pings @everyone; only the chosen role is allowed to be mentioned.
- **Leveling** (off until `/level enable`): 15-25 XP per message, 60s cooldown, min 3 characters (all changeable with `/level xp`, `min-length`).
  Voice XP (`/level voice`), server speed (`/level multiplier`), role boosts (`/xp boost-set`, best boost only), ignored channels/roles (`/xp ignore-add`).
  Level-up message: `/level message`, `style` (card/embed/text), `announce` (current channel / fixed channel / DM / silent), `ping`, `placeholders`, `test`.
  Placeholders: {user} {username} {displayname} {level} {oldlevel} {xp} {rank} {server} {role}.
  Level roles (optional): `/levelrole add|remove|list|mode|sync`; mode stack or replace; powerful roles refused; returning members get them back.
  Leaderboards (optional command): `/leaderboard period:all|daily|weekly|monthly previous:true`, page buttons; `/rank`.
  Automatic highlights: `/level highlights period channel` posts the previous day/week/month when it ends (UTC; first run only remembers the period).
  Admin tools: `/xp add|set-level|reset-member|reset-all (type RESET)`.
  Pictures need `@napi-rs/canvas` (falls back to embeds without it).
- Daily XP rows older than 400 days are deleted at startup.
- Tests: 147 unit tests; offline flow checks (16 steps) use fake Discord objects and a stand-in for discord.js.

## 6g. Milestone 10: giveaways and events (built, awaiting live testing)

Migration `013_giveaways_events.sql` (giveaways, giveaway_entries, events, event_rsvps). Service: `giveaways` (`.giveaways`, `.events`). Scheduler runs every 15 s.

- `/giveaway start|end|reroll|cancel|list` (Manage Server). Enter with a button (click again to leave). Requirements: role, leveling level, days in server, bypass role; ping role.
  Requirements are checked again when the giveaway ends, so people who left or lost the role cannot win. Reroll never repeats winners. Ending happens exactly once (atomic status change).
  Button replies are private to the clicker (public-channel button flow); command replies are public.
- `/event create|list|cancel` (Manage Events). Going / Maybe / Not going buttons, live counts, reminder 15 min before and a "starting now" message. `when` accepts `2h`, `3d` or `2026-12-24 18:00` (+ `utc-offset:8` for Malaysia).
- Limits: 25 running giveaways, 25 upcoming events per server; giveaway 10 s to 60 days; events up to one year ahead.
- Tests: 153 unit tests; 20 offline flow checks (fake Discord objects).

## 6h. Milestone 11: text commands like `!ban` (built, awaiting live testing)

- Every slash command can also be typed: `!ban @user 7d reason`, `!warn @user reason`, `!purge 10`.
  It runs the SAME command code through a fake "interaction" built from the message
  (`src/textcommands/adapter.js`), so permissions and behaviour are identical.
- Off by default. `/textcommands enable|disable|prefix|mention|block|allow|alias-add|alias-remove|status` (Manage Server).
- Prefix: 1-5 characters (default `!`). `@Incomu ban @user` also works (switchable).
- Aliases: `/textcommands alias-add alias:b command:"ban"` (can include one subcommand, e.g. "automod status").
- Replies are normal messages that reply to the typed message; "only you can see" replies become normal replies.
- Commands that open pop-up forms or need file uploads say to use the slash version.
- Safety: permission gate from each command's required permission, 1.2 s limit per person, unknown words ignored silently,
  mentions never ping, errors never show stack traces, `/textcommands` itself is slash-only.
- Files: migration 014, `src/services/textCommandService.js`, `src/textcommands/{parser,adapter,handler}.js`,
  `src/events/textcommands/textCommandMessage.js`, `src/commands/admin/textcommands.js`, `tests/milestone11.test.js`.
- Needs the Message Content intent (already enabled in the project).

## 6i. Milestone 12: moderation finished (built, awaiting live testing)

- `/quarantine add|remove|setup|sync|list`: the member's roles are saved and replaced by one empty "quarantine role" that can only see one
  channel. `remove` gives the saved roles back (deleted roles, bot roles and roles above the bot are skipped). Leaving and rejoining while
  quarantined puts the role back. Creates cases (`quarantine`, `unquarantine`). Setup/sync need Manage Server; add/remove need Moderate Members.
- `/sanitize user|all`: fancy fonts, zalgo, invisible names and names starting with symbols become plain names (up to 100 per `all` run).
- `/vc kick|mute|unmute|deafen|undeafen|move`: voice moderation, each with its own Discord permission, logged to the mod log.
- `/massban ids reason delete_days`: up to 100 IDs, confirm/cancel buttons (only the same moderator, 2 minutes, runs once), hierarchy rules per
  person, one case per ban, one summary log entry.
- `/modstats [user] [days]`: actions per moderator from the cases table.
- `/report user reason` (everyone) + `/reportconfig channel|ping-role|disable|status`: reports go to a staff channel with Resolve/Dismiss
  buttons; 3 reports per hour per member; typed `!report` messages are deleted so the report stays private.
- Migration 015 rebuilds the `cases` table (new types) keeping all data, adds quarantine and report tables.
- All of these also work as text commands (e.g. `!vc kick @user`, `!massban id id id reason`).
- Files: `src/modextras/rules.js`, `src/services/{quarantine,report}Service.js`, `src/commands/moderation/{quarantine,sanitize,vc,massban,modstats,report,reportconfig}.js`,
  `src/events/moderation/quarantineRejoin.js`, `tests/milestone12.test.js`.

## 6j. Milestone 13: anonymous confessions (built, awaiting live testing)

- One confession channel per server (like tickets). `/confession setup channel [cooldown]` posts a panel with a Confess button.
- `/confess [text]` works only in that channel (moderators with Manage Messages can use it anywhere; it still posts in the confession channel).
  Without text it opens a form. Every posted confession has a **Confess** button under it, so people can keep going.
- Look (reference image): bot embed "Anonymous Confession (#N)", the text in quotes, a random colour side bar.
- Anonymity: the bot posts it; the member's confirmation is private (a public reply would show "X used /confess").
  The author ID is stored ONLY so staff can block abusers by number. No command shows it.
- `/confession delete|block|unblock|blocked|status|disable` (Manage Messages; setup/disable need Manage Server).
  `block <number>` blocks the author of that confession without revealing who they are.
- Rules: 3-1800 characters, no server invite links, @everyone/@here neutralised, cooldown per person (default 60 s, 10-3600),
  failed posts are undone so they do not use the cooldown.
- Typed `!confess ...` is refused: the message is deleted and the member is pointed to `/confess` (slash-only list in `src/textcommands/slashOnly.js`).
- Files: migration 016, `src/confessions/{confessionRules,confessionFlow}.js`, `src/services/confessionService.js`,
  `src/commands/confessions/{confess,confession}.js`, `tests/milestone13.test.js`.

## 6k. Milestone 14: utility (built, awaiting live testing)

- `/poll create|end|list`: 2-10 options (separated by |), optional duration (1 min to 30 days) and multiple-choice. People vote with number
  buttons; the poll updates live (bars + percentages), buttons toggle/replace votes. The timer ends due polls and posts the winner; the
  creator or a moderator can end it early. Max 10 open polls per server.
- `/remind add|list|cancel`: a time like `10m`, `2h`, `1d12h` or a date (`2026-12-24 18:00`, with `utc-offset`). Delivered in the same channel
  (mentions only the owner), DM fallback, "a bit late" note if the bot was offline. 25 pending per person; exactly-once delivery.
- `/suggest text` + `/suggestion setup|disable|approve|deny|consider`: embed with author, 👍/👎 vote buttons (switch/remove votes), staff status
  and note; approve/deny close voting.
- `/starboard setup|disable|status`: messages reaching N reactions (default 3 x ⭐; any emoji) are copied to a channel with a jump link and
  image; the author's own star and bots do not count; updates the count, removes the post if it falls below N; never copies NSFW channels;
  race-safe (one post per message).
- `/userinfo`, `/serverinfo`, `/avatar`.
- Timer: `startUtilityScheduler` (15 s) runs reminders and poll endings. Migration 017.
- Typed form of `/poll create` needs quotes: `!poll create "Best food?" "Pizza | Tacos" 1h`.
- Files: `src/utility/{rules,utilityFlow}.js`, `src/services/{poll,reminder,suggestion,starboard}Service.js`,
  `src/commands/utility/{poll,remind,suggest,suggestion,starboard,userinfo,serverinfo,avatar}.js`,
  `src/events/utility/starboardReaction{Add,Remove}.js`, `tests/milestone14.test.js`.

## 6l. Milestone 15: /help and /setup (built, awaiting live testing)
- `/help`: reads the real command list (cannot go stale). Topic menu (15 groups), paged lists, per-command help (permissions, usage, every action, copyable examples, tips), word search with synonyms ("raid", "mute") and "did you mean". Buttons only work for the person who opened it.
- `/setup` (Manage Server): live checklist (5 essentials with progress bar + "next step"), 14 step-by-step guides (basics, logs, moderation, security, verification, tickets, welcome, roles, leveling, giveaways, community, channels, text commands, FAQ) each showing your server's current status, "Check my setup" (bot permissions, role position, deleted/unwritable channels, roles above the bot, picture support) and "Quick setup" (creates staff-only #incomu-logs, #ban-appeals, #reports, the Quarantined role + #quarantine; only what is missing; does NOT switch on anti-nuke/automod).
- Files: `src/help/*`, `src/setup/{status,guides,health,quick,setupFlow}.js`, commands `help`, `setup`; component prefix `st` (help uses `hp`). `quarantine.js` now exports `syncChannels`.
- Tests: `tests/milestone15.test.js` also checks every `/command option:` written in guides/examples against the real commands. Suite: 231 passing offline.

## 6m. Milestone 16: fun (built, awaiting live testing)
- Games (buttons/forms, in memory, slash-only): `/trivia` (45 built-in questions, 5 topics, first correct wins), `/rps` (vs bot or member, picks secret), `/tictactoe`, `/connect4`, `/guess number`, `/guess word` (hangman), `/wouldyourather`, `/truthordare`, `/gamestats` (wins + top 10).
- Quick: `/8ball`, `/coinflip`, `/dice`, `/choose`, `/ship`, `/rate`, `/action` (hug, pat, high-five...), `/joke`. All content is built in (no websites needed). No `/meme` (needs an outside source).
- Social: `/birthday` (set/remove/view/upcoming + staff channel/role/message/status; time zone offset; 29 Feb handled; role removed at end of day; announced once), `/afk`, `/counting` (one number at a time, no double counting, record + stats), `/bump` (DISBOARD "Bump done" -> reminder after 2 hours; unverified against live DISBOARD), `/fun` (games on/off + channel limit, AFK on/off, status).
- Economy was dropped on request.
- Files: migration `018_fun.sql`, `src/services/funService.js`, `src/fun/{rules,games,data,funFlow}.js`, `src/commands/fun/*` (21 commands), event `fun/funMessage.js`; prefix `fn`; scheduler `startFunScheduler` (30 s). /help has two new groups (Games, Fun & social); /setup has a Fun section and a Fun guide.
- Command count is now 84 (Discord allows 100 global slash commands).
- Tests: `tests/milestone16.test.js`; suite 269 passing offline.
- UPDATE (Milestone 18): the 16 fun slash commands were folded into `/play` (trivia, rps, tictactoe, connect4, guess-number, hangman, would-you-rather, truth-or-dare, stats) and `/random` (coinflip, dice, 8ball, choose, rate, ship, joke, action). Old text names still work (`!8ball`, `!rps`, `!gamestats`...) through `src/textcommands/builtinAliases.js`. Old slash names are gone after `node src/deploy-commands.js`.

## 6n. Milestone 17: translation with Google Translate (built, awaiting live testing)
- The website/dashboard was started and then abandoned on request (no files shipped, no migration). It can be revisited later.
- `/translate to:<language> text:<text or message link>` (language by name or code, auto-detects the source), `/languages [search]`, staff `/translateconfig` (flags, auto-add, auto-remove, auto-list, limit, usage, status).
- Flag reactions: react with a flag emoji (64 flags -> 57 languages) on a message to get a translation reply (once per message+language, 8 s cooldown per person).
- Auto-translate channels (max 5 per server): messages in another language get a translation reply; skips same language (refunded), links, emoji, bots, typed `!commands`.
- Cost control: per-server daily character limit (default 50,000, 1,000 to 1,000,000), booked atomically before calling Google and refunded on failure; 1,500 characters max per request; mentions/custom emoji/@everyone removed before sending; replies never ping.
- Uses Cloud Translation Basic (v2), `POST .../language/translate/v2?key=...`, `format: text`. Key in `.env` as `GOOGLE_TRANSLATE_API_KEY` (never logged: the logger redacts it, errors never contain it). Without a key everything else works and the commands explain what to do. The first 500,000 characters per month are free (Google pricing page); billing must be enabled.
- Files: migration `019_translate.sql`, `src/services/translateService.js`, `src/translate/{languages,rules,googleClient,translateFlow}.js`, `src/commands/translate/{translate,languages,translateconfig}.js`, events `translate/translateReactionAdd.js` and `translateMessage.js`. /help has a Translation group; /setup has a Translation guide and checklist item.
- Command count: 87. Tests: `tests/milestone17.test.js`; suite 285 passing offline (Google is faked: the live call has not been tested).

## 6o. Milestone 18: command cleanup + custom commands + auto-replies (built, awaiting live testing)
- Cleanup: 87 -> 73 slash commands (see the update under 6m).
- `/tag use|list|info` for everyone; `/tag create|edit|delete` need Manage Server. Reply can use `{user} {username} {server} {channel} {members} {args}`; `\n` makes a new line; leaving the reply empty opens a form (slash only). Text commands: `!name` runs a custom command when text commands are on. Built-in commands, built-in text aliases, `help` and `tag` cannot be shadowed (name check on create; built-ins win at runtime). 100 per server, 1900 characters, 2.5 s per-person cooldown.
- `/autoresponder add|remove|toggle|list|test` (Manage Server): match contains / whole word / starts with / exactly, per-reply cooldown (default 30 s, max 3600), optional single channel, 50 per server. Ignores bots, webhooks, DMs and messages starting with the text-command prefix. Needs the Message Content intent (same as text commands).
- All replies use `allowedMentions` with nothing parsed, so `@everyone` in a reply never pings.
- Files: migration `020_custom_commands.sql`, `src/services/customService.js`, `src/custom/{rules,customFlow}.js`, `src/commands/custom/{tag,autoresponder}.js`, `src/events/custom/autoresponderMessage.js`; wired in `index.js` (service + component prefix `tg`) and `src/textcommands/handler.js`; help category 'custom', setup guide 'custom', `/setup` status item.
- Command count: 75. Tests: `tests/milestone18.test.js`; suite 293 passing offline.

## 6p. Milestone 19: announcements, scheduled posts, sticky messages (built, awaiting live testing)
- `/embed send|form|edit` (Manage Messages): title, description (`\n` = new line), colour (hex or name), footer, image, thumbnail, optional text above and one role to ping. `form` opens a form (slash only). `edit` changes an embed that I posted (message link). The user must be able to send messages in the target channel; I need View/Send/Embed Links.
- `/schedule add|list|remove|toggle` (Manage Server): `when` = `2h`/`1d12h` or `YYYY-MM-DD HH:MM` with `utc-offset`; optional `repeat` (10 min to 30 days) and `times`; message and/or embed; optional role ping. 25 per server. Checked every 20 s; claimed atomically (exactly once); posts more than a day late are skipped; a failed send DMs the creator; a repeating post that fails 3 times in a row switches off.
- `/sticky set|remove|list` (Manage Messages): embed or plain; reposted ~4 s after chat (one repost per burst, old copy deleted); ignores my own messages; 10 per server.
- Safety: only the chosen role is ever pinged (`allowedMentions`), never @everyone; image links must be https.
- Files: migration `021_posts.sql`, `src/services/postService.js`, `src/posts/{rules,postFlow}.js`, `src/commands/posts/{embed,schedule,sticky}.js`, `src/events/posts/stickyMessage.js`; `index.js` (service + component prefix `ep`), `ready.js` (scheduler); help category 'posts', guide 'posts', `/setup` status item.
- Command count: 78. Tests: `tests/milestone19.test.js`; suite 305 passing offline.

## 6q. Milestone 20: growth tools (built, awaiting live testing)
- Invite tracker: `/invites stats|top` for everyone; `enable|disable|who|reset` need Manage Server. Compares the invite list before/after each join (needs Manage Server for me and the Invites intent, already on). One row per member (rejoins count once, newest inviter wins, no self-invites); fake = account under 7 days; joins handled one at a time per server; each join is written to the members log; used-up invites are spotted; vanity/simultaneous joins show as unknown.
- Sticky roles: `/stickyroles enable|disable|status|forget`. Roles are saved on leave and given back on rejoin within 90 days. Never restored: managed/bot roles, roles with staff permissions (Administrator, Manage Server/Roles/Channels/Messages/Webhooks/Nicknames/Events/Threads, Kick, Ban, Timeout, Mention Everyone), roles I cannot assign, and anything for quarantined members. Off by default.
- Counter channels: `/membercount add|remove|list` (Manage Channels). Text like `Members: {members}`; tokens members, humans, bots, boosts, boostlevel, channels, roles. Checked every 5 minutes; a channel is renamed at most once per 10 minutes (Discord limit); `{humans}`/`{bots}` only when the member list is fully loaded. 5 per server. A deleted channel removes its counter.
- The account-age gate was NOT built again: AutoMod already has the "new account" rule (alert/timeout/kick).
- Files: migration `022_growth.sql`, `src/services/growthService.js`, `src/growth/{rules,growthFlow}.js`, `src/commands/growth/{invites,stickyroles,membercount}.js`, `src/events/growth/{growthJoin,growthLeave,inviteCreateCache}.js`; `index.js` (service), `ready.js` (scheduler); help category 'growth', guide 'growth', `/setup` status item.
- Command count: 81. Tests: `tests/milestone20.test.js`; suite 316 passing offline.

## 6r. Milestone 21: command rules + owner tools (built, awaiting live testing)
- `/commandrules role|channel|disable|enable|clear|list` (Manage Server): per command, allow/block a role, allow/block a channel (a category covers its channels and threads), or switch it off. Any "allow" rule blocks everyone else. Administrators and the server owner ignore role/channel rules but not "switched off". `help`, `setup`, `commandrules`, `owner` can never be restricted. Applies to slash AND text commands; checked in `src/events/interactionCreate.js` and `src/textcommands/handler.js`. The command name option uses autocomplete (new: `interactionCreate` now answers autocomplete requests via `command.autocomplete`). 200 rules per server. Per top-level command only (not per subcommand).
- Owner = the bot's owner/team from the Developer Portal (looked up at startup) plus optional `OWNER_IDS` in `.env` (user IDs, not secret). If unknown, `/owner` is locked with a hint.
- `/owner backup|blacklist-add|blacklist-remove|blacklist-list|servers|errors-set|errors-off|errors-test` (replies private; default visibility Administrators only). Backups: `VACUUM INTO` copy in `data/backups/bot-YYYYMMDD-HHMMSS.sqlite`, automatic about daily, newest 7 kept, never sent over Discord. Global blacklist: blocks every slash command, button, form and text command silently/privately; owners and bots cannot be listed. Error alerts: `logger.error` now feeds an optional sink; alerts go to the chosen private channel (same error at most once a minute, max 20 an hour, secrets already redacted).
- `/botinfo` (everyone): servers, members, commands, uptime, ping, memory, runtime.
- Files: migration `023_access_owner.sql` (command_rules, global_blacklist, bot_config), `src/services/accessService.js`, `src/access/{rules,accessFlow}.js`, `src/owner/ownerFlow.js`, `src/commands/tools/{commandrules,botinfo,owner}.js`; edited `index.js` (`client.db`, access service), `ready.js`, `interactionCreate.js`, `textcommands/handler.js`, `utils/logger.js`; help category 'tools', guide 'access', `/setup` status item.
- Command count: 84. Tests: `tests/milestone21.test.js`; suite 328 passing offline.

## 6s. Milestone 22: warn escalation + ban list export/import (built, awaiting live testing)
- `/warnescalation add|remove|toggle|window|list` (Manage Server). Rules like "3 warnings = timeout 60 min", "5 warnings = ban" (up to 10; timeout needs minutes, max 28 days). After `/warn` saves the case, `runMemberAction` now calls an optional `afterAction` hook; `src/moderation/escalationFlow.js` counts ACTIVE warnings (pardoned ones do not count; optional window in days) and applies the rule whose number EXACTLY equals the count. The action is saved as a normal case by the bot ("Automatic: reached N warnings"), written to the mod log, announced in the channel, and our own events are suppressed so nothing is logged twice. Never acts on the server owner or anyone the bot cannot moderate (it says a moderator must act). Off by default.
- `/banlist export|import|copy` (Ban Members; slash only). `export` = private (ephemeral) CSV file of all bans. `import file:` reads a .txt/.csv (one ID per line, or an export; Discord-hosted files only, 1 MB max, 15 s download limit). `copy server:` copies another server's bans (you need Ban Members there too and the bot must be in it). Both show a preview and use the same Confirm/Cancel buttons and ban engine as `/massban` (prefix `mb`); already-banned accounts, you, the bot and the owner are skipped; 300 accounts at a time.
- Files: migration `024_warn_escalation.sql`, `src/services/escalationService.js`, `src/moderation/{escalation,escalationFlow}.js`, `src/modextras/banlist.js`, `src/commands/moderation/{warnescalation,banlist}.js`; edited `caseService.js` (`countActiveWarnings`), `runMemberAction.js` (afterAction), `warn.js`, `massban.js` (exports `buttons`, `sweep`, `EXPIRES_MS`), `slashOnly.js`, `index.js`; help (moderation category), guide 'escalation', `/setup` status item.
- Command count: 86. Tests: `tests/milestone22.test.js`; suite 338 passing offline.

## 6t. Milestone 23: voice time statistics (built, awaiting live testing)
- Checked first: welcome/goodbye picture cards already exist (style `card` in `/welcome` and `/goodbye`, `src/welcome/welcomeCard.js`) and voice XP already exists (`voiceXp` setting, per-minute `voiceTick` in `levelFlow.js`), so neither was rebuilt.
- New: time spent in voice as its own statistic. `/voicetime stats [user]` (all time, today, this week, this month, rank), `/voicetime top [period] [previous]` (top 10, all/daily/weekly/monthly in UTC like `/leaderboard`), staff: `enable|disable|reset user` (Manage Server). Off by default. A scheduler counts one minute per person per minute: bots, deafened members and the AFK channel are skipped; being alone still counts. Daily rows are kept about 62 days, totals forever.
- Files: migration `025_voice_time.sql`, `src/services/voiceTimeService.js`, `src/voicetime/voiceTimeFlow.js`, `src/commands/leveling/voicetime.js`; `index.js`, `ready.js`; help (leveling category), guide 'voicetime', `/setup` status item.
- Command count: 87. Tests: `tests/milestone23.test.js`; suite 343 passing offline.

## 6u. Milestone 24: modmail (built, awaiting live testing)
- New: members DM the bot; staff answer from a private channel. `/modmail setup|enable|disable|status|close|block|unblock|blocked`. Staff messages go to the member; messages starting with `//` are private notes. Close (button or command) posts a text transcript to the log channel, DMs the member, deletes the channel. One open conversation per member per server (database-enforced); members in several modmail servers pick the server from a menu; blocked members and bot-blacklisted users are refused; relay rate limit; no pings.
- Files: migration `026_modmail.sql`, `src/services/modmailService.js`, `src/modmail/{rules,modmailFlow}.js`, `src/commands/modmail/modmail.js`, `src/events/modmail/modmailMessage.js`, button prefix `mm`.
- `index.js`: new intent `DirectMessages` and partial `Channel` (needed for DMs; no privileged intent), `modmail` service, startup warning for leftover command files (`src/utils/commandCheck.js`).
- Fixed a real limit problem: `/setup` `topic` had 25 choices (Discord maximum). It is now autocomplete; the `/setup` guide menu and `/help` topic menu split into several menus of 25. Guide count is no longer capped.
- Owner found 104 command files (stale files from folded fun commands + old `utlity\ping.js`); fixed by moving them out. Correct count is 88 with modmail.
- Command count: 88. Tests: `tests/milestone24.test.js`; suite 355 passing offline.

## 6v. Milestone 25: raid mode + translation removed (built, awaiting live testing)
- Removed (owner request): the whole translation feature (`/translate`, `/translateconfig`, `/languages`, flag reactions, auto-translate, Google client/service, guide, help, status, tests). `parseMessageLink` moved to `src/utils/messageLink.js` (used by posts). Migration `019_translate.sql` is kept (numbered migrations are never edited); its tables are simply unused.
- New: `/raidmode setup|enable|disable|start|end|status`. Detects N joins within S seconds (default 10 in 30; bots ignored; same person rejoining counts once), then: raises verification to High (remembers the old level), pauses invites (needs recent discord.js; skipped if unsupported), alerts staff with an End button (optional role ping), and applies action alert/timeout(1h)/kick to raiders. Ends by itself `duration` minutes (default 15) after the last raider (checked every 30 s), restoring only what it changed (does not overwrite a level an admin changed meanwhile). One active raid per server (database-enforced); ending happens once.
- Files: migration `027_raid_mode.sql`, `src/services/raidService.js`, `src/raid/{rules,raidFlow}.js`, `src/commands/security/raidmode.js`, `src/events/raid/raidJoin.js`, button prefix `rm`; `index.js`, `ready.js`, help, guide `raidmode`, status item.
- Command count: 86 (translation -3, raid mode +1, modmail +1 from before). Tests: `tests/milestone25.test.js`; milestone17 tests removed with the feature.

## 6w. Milestone 26: question of the day (built, awaiting live testing)
- New: `/qotd setup|add|list|remove|post|enable|disable|status`. Posts one question a day at a chosen time (24-hour `HH:MM`, `utc_offset` in whole hours), optional role ping, optional thread for answers. About 50 built-in questions plus the server's own (max 200, 10-300 characters, `@everyone` neutralised). Own questions first (each once), then built-in, no repeats until everything was used, then a new round. One post per local day (atomic claim), also after downtime; running setup after today's time does not post immediately. `/qotd post` posts one now without skipping tomorrow.
- Files: migration `028_qotd.sql`, `src/services/qotdService.js`, `src/qotd/{rules,bank,qotdFlow}.js`, `src/commands/fun/qotd.js`; `index.js`, `ready.js` (30 s scheduler), help category, guide, status item.
- Command count: 87. Tests: `tests/milestone26.test.js`; suite 356 passing offline.

## 6x. Milestone 27: server backup and restore (built, awaiting live testing)
- New: `/serverbackup create|list|info|restore|delete|auto` (Administrator only). A backup is plain data: roles (not bot-managed, not @everyone, with colour/hoist/permissions/position), categories and channels (text, voice, announcement, stage, forum: topic, nsfw, slowmode, user limit, category, position) and all permission overwrites (roles by key, @everyone, members). Not saved: messages, members, bans, emojis, bots, threads. Max 10 manual backups per server (900 KB cap each); automatic ones (`auto days:N`, keeps latest 3) are checked every 10 minutes.
- Restore: preview with counts + Confirm/Cancel (same admin only, 5 minutes). Default only CREATES what is missing (matched by name; channels by name + type + category); never deletes. Optional `fix_existing` (puts saved permissions back on existing roles/channels) and `settings` (server name, verification level etc.). Roles are placed below the bot's highest role. Each failed step is reported, others continue; re-running creates only what is still missing. One restore at a time per server; backups can only be read by the server that made them.
- Files: migration `029_server_backups.sql`, `src/services/backupService.js`, `src/serverbackup/{snapshot,restore,backupFlow}.js`, `src/commands/admin/serverbackup.js`, button prefix `sb`; `index.js`, `ready.js`, help, guide, status item.
- Command count: 88. Tests: `tests/milestone27.test.js`.

## 6y. Milestone 28: 24/7 hosting guide + docs files (built)
- New docs: `README.md`, `docs/SETUP.md` (zero to running), `docs/HOSTING.md` (own PC, VPS with pm2/systemd, safe updates, backups, moving PC to VPS, security), `docs/TROUBLESHOOTING.md`, `docs/COMMANDS.md` (generated from the /help catalog by `node scripts/generate-docs.js`; a test fails if it is out of date). Hosting prices are rough ranges from a September 2026 comparison article and are labelled "check the provider".
- New files: `ecosystem.config.js` (pm2: auto restart, 400 MB memory limit, gives up after 20 quick crashes), `scripts/start-incomu.bat` (Windows restart loop), `scripts/update-linux.sh` (stop, copy database, unzip, install, TEST, only then start), `scripts/generate-docs.js`. In-bot guide `hosting` under `/setup`.
- Bug found and fixed: the /help catalog listed `/ping` but no `/ping` command existed in the project (the owner's original M1 file had been moved out as "stale" by mistake). `/ping` restored at `src/commands/utility/ping.js`. New test: every command in /help is real and every real command is in /help.
- Command count: 89. Tests: `tests/milestone28.test.js`; suite 371 passing offline.
- Plan status: everything in the agreed plan is delivered. Open: music (on hold), website (abandoned), social alerts (cancelled), translation (removed).

## 7. Decisions pending from the owner

1. Text commands: confirm that "suffix" means a prefix such as `!ban`. Needs the Message Content
   privileged intent (toggle in Developer Portal; verification required at 100+ servers).
2. Music: no unauthorized scraping. Proposed: a legitimate provider route only (see chat plan).
3. Quarantine design: a role created/selected by the admin that removes all access except one channel.
4. Logging visuals: reference images 1-20 received (analysis in chat). More coming.
5. Privileged intents to enable later: Server Members (joins/leaves, roles), Message Content
   (text commands, deleted-message content). Not needed yet.

## 8. Known issues / to verify

- Official Discord docs could not be fetched in the build sandbox; audit-log delay behaviour,
  privileged-intent thresholds, and Components V2 limits must be re-checked from official docs
  before the phases that depend on them.
- `setDMPermission(false)` may log a deprecation notice in newer discord.js; still works.
- Ban/kick/timeout were not tested against real Discord yet.
- Data retention: nothing is deleted when the bot leaves a server. Needs a retention policy.

## 9. Next exact steps

0. Owner: `node src/deploy-commands.js`, restart, test the Milestone 8 and 9 checklists.

1. Owner enables Server Members + Message Content intents, runs Milestone 4 checklist, reports exact errors.
2. Auto-moderation (with `/automod enable|disable`). (Moderation is now complete: Milestone 12.)
3. Anti-nuke (uses audit service + log service), then auto-mod. Then Phase 3 (tickets/verification use the
   same style helpers; reference images 5-9 are the target look).
