# Incomu

An all-in-one Discord bot: moderation, auto-moderation, anti-nuke and raid protection, logging, tickets and modmail, verification, welcome messages, roles, leveling, giveaways, custom commands, scheduled posts, growth tools, fun, and server backups. Written in JavaScript (Node.js 24, discord.js v14) with a built-in SQLite database. Every server's data is separate.

## What is inside
* **Protect:** manual moderation (`/ban`, `/warn`, `/timeout`...), automatic warning escalation, `/automod`, `/antinuke`, `/raidmode`, `/quarantine`, `/lockdown`, `/massban`, verification with a captcha.
* **Support:** `/ticket` panels with transcripts, `/modmail` (members DM the bot to reach staff), reports, ban appeals, confessions.
* **Community:** welcome and goodbye messages, auto-roles and reaction roles, leveling and voice time, giveaways and events, polls, suggestions, starboard, `/qotd` (question of the day), birthdays, counting, games.
* **Make it yours:** `/tag` and `/autoresponder`, `/embed`, scheduled and sticky posts, member-count channels, invite tracking.
* **Look after it:** `/serverbackup` (roles and channels), `/owner` tools (database backups, blacklist, error alerts), `/botinfo`, per-command rules.

The full list is in [docs/COMMANDS.md](docs/COMMANDS.md). In Discord, type `/help` for details and `/setup` for a guided checklist.

## Quick start (Windows)
1. Follow [docs/SETUP.md](docs/SETUP.md) once: install Node.js 24, create the bot in the Discord Developer Portal, invite it, make your `.env`.
2. In the project folder:
   ```
   npm install
   node src/deploy-commands.js
   node index.js
   ```
3. In your server run `/setup`.

To keep it online all day and night read [docs/HOSTING.md](docs/HOSTING.md). If something breaks read [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Project layout
```
index.js                 starts the bot
src/commands/            one file per slash command (grouped in folders)
src/events/              what the bot does when something happens
src/services/            database logic, one service per feature
src/<feature>/           rules and flows for each feature
src/database/migrations/ numbered database changes (never edited, only added)
data/                    your database and its backups (never share, never delete)
tests/                   automatic tests: node --test tests/*.test.js
docs/                    guides
scripts/                 helper scripts (update, start, generate docs)
```

## Rules of thumb
* The **token** lives only in `.env`. Never share it, commit it or screenshot it.
* Run the tests after every update: `node --test tests/*.test.js`.
* After adding or changing commands run `node src/deploy-commands.js`.
* Discord allows 100 slash commands per bot. `docs/COMMANDS.md` shows how many Incomu uses.
* Keep your `data` folder safe. `/owner backup` makes a copy.
