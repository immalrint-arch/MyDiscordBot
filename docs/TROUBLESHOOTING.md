# Troubleshooting

When you ask for help, always copy the **exact error text** and say what you were doing. **Never** include your token, your `.env` file or any API key. If one leaks, reset it in the Developer Portal (**Bot → Reset Token**).

## The bot will not start
| Message | What it means and what to do |
|---|---|
| `An invalid token was provided` | The `DISCORD_TOKEN` in `.env` is wrong or was reset. Copy a fresh token (Developer Portal → Bot → Reset Token) into `.env`. No quotes, no spaces |
| `Used disallowed intents` | Developer Portal → Bot → turn on **Server Members Intent** and **Message Content Intent**, save, restart |
| `Cannot find module '...'` | Run `npm install` in the project folder. If the missing file is one of ours (starts with `./`) an old file is left over or an update was only half unzipped: unzip the latest zip again |
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node is too old. `node -v` must print `v24` or newer |
| `ExperimentalWarning: SQLite is an experimental feature` | Harmless. Ignore it |
| `no such table` or a migration error | The database and the code are out of step. Do not delete `data/`. Copy the whole message and ask for help. A fresh start without losing data: stop the bot, copy `data/bot.sqlite` somewhere safe, update to the latest zip, start again (migrations run by themselves) |
| `[INFO] ... is OFF` lines | Information only, not an error |

## Commands
| Problem | Fix |
|---|---|
| `Maximum number of application commands reached (100)` | Your `src/commands` folder has more command files than the current version. Old zips never deleted files that were later removed. When the bot starts it now prints "N command(s) are not part of this version (old files?)" with their names: move those files out of `src/commands` (into a folder like `old_commands` outside `src`) and run `node src/deploy-commands.js` again. `docs/COMMANDS.md` lists the commands the current version has |
| Slash commands do not show up | Run `node src/deploy-commands.js`, wait a minute, restart Discord (Ctrl+R). Check the bot was invited with the `applications.commands` scope |
| An old command still shows | Deleted commands disappear after the next successful `deploy-commands` |
| `Unknown interaction` or "The application did not respond" | The bot is offline or too slow. Check the terminal for errors. Make sure only one copy of the bot runs |
| The bot answers twice | Two copies run with the same token (PC and server, or two terminals). Stop one |
| `Missing Permissions` or `Missing Access` | The bot lacks a permission, or its role is **below** the role it is changing. Move its role up and re-check channel permissions. `/setup` → **Check my setup** finds the problem |
| "You need the ... permission" | The command needs that permission for you. Server admins can also change who may use a command with `/commandrules` |

## Features
| Problem | Fix |
|---|---|
| Modmail: nothing happens when I DM the bot | Run `/modmail status`. It must be **on** with a category, staff role and log channel. The DMing person must share a server with the bot and not be blocked. Check their privacy setting allows DMs from server members |
| Modmail: "I couldn't DM this member" | They closed DMs, or blocked the bot |
| Raid mode: "Pausing invites needs a newer discord.js" | Run `npm install discord.js@latest`, then restart. Everything else in raid mode still works without it |
| Raid mode: could not raise verification | The bot needs **Manage Server** |
| Level, quote or welcome **pictures** are plain embeds | Optional package missing: `npm install @napi-rs/canvas` then restart |
| `/serverbackup restore` says some steps failed | Usually the bot's role is too low or it lacks Manage Roles / Manage Channels. Fix and run the restore again: it only creates what is still missing |
| Question of the day did not post | `/qotd status`. Check the channel, the time and `utc_offset`, and that the bot can send messages and create threads there |
| Scheduled posts or reminders are off by hours | Time zones: use the `utc-offset` option (hours from UTC) |
| Ticket or confession buttons do nothing after an update | The bot was probably offline. Press the button again. If it still fails, post the exact message |

## Updating
* **A milestone zip only adds and replaces files.** It never deletes. If the instructions say "delete these files", do that first.
* After every update: `npm install`, `node --test tests/*.test.js`, `node src/deploy-commands.js`, then start the bot.
* Keep a copy of `data/bot.sqlite` before big updates (`/owner backup`).

## Hosting
See the last table in [HOSTING.md](HOSTING.md).

## Still stuck?
Send: the exact error text, the command you ran, what you expected, and the output of `node -v`. Do not send your token or `.env`.
