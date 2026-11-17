# Setting up Incomu from zero

You do this once. It takes about 20 minutes.

## 1. Install the tools
1. **Node.js 24** (the LTS version) from nodejs.org. Check in a new terminal: `node -v` shows `v24...`. Incomu uses the built-in `node:sqlite`, so older Node versions will not work.
2. **VS Code** (optional but handy) from code.visualstudio.com.

## 2. Create the bot in Discord
1. Open the Discord Developer Portal (discord.com/developers/applications) and click **New Application**. Name it.
2. On the **General Information** page copy the **Application ID**. It is your `CLIENT_ID`.
3. Open **Bot** in the left menu.
   * Click **Reset Token** and copy the token. **This is a password: anyone with it controls your bot. Never paste it in chats, screenshots or GitHub.**
   * Under **Privileged Gateway Intents** turn on **Server Members Intent** and **Message Content Intent**, then save.
4. Open **OAuth2 → URL Generator**. Tick the scopes `bot` and `applications.commands`. For permissions the easy choice is **Administrator** (fine for your own test server). For a public server pick only what you need: Manage Roles, Manage Channels, Kick Members, Ban Members, Moderate Members, Manage Messages, View Audit Log, Manage Server, Send Messages, Embed Links, Attach Files, Read Message History, Add Reactions, Create Public Threads.
5. Open the generated URL, choose your server and **Authorize**.
6. In Discord, drag the bot's role **high** in **Server Settings → Roles**. A bot can only manage roles below its own.

## 3. Get the project ready
1. Put the project in a folder, for example `C:\Users\YOU\Documents\MyDiscordBot`.
2. Open that folder in VS Code and open the terminal (**Terminal → New Terminal**).
3. Create a file called `.env` in the project folder with your values (the exact names used by your project, for example):
   ```
   DISCORD_TOKEN=your-token-here
   CLIENT_ID=your-application-id
   GUILD_ID=your-test-server-id
   OWNER_IDS=your-own-user-id
   ```
   `OWNER_IDS` is optional (the bot already treats the application's owner as its owner). No quotes, no spaces around `=`. To copy IDs turn on **Developer Mode** in Discord (**Settings → Advanced**), then right-click a server or user and choose **Copy ID**.
4. Install the packages:
   ```
   npm install
   ```
   Optional, for pictures (quote cards, level cards, welcome cards): `npm install @napi-rs/canvas`. Without it the bot works and uses plain embeds.

## 4. Register the commands and start
```
node src/deploy-commands.js
node index.js
```
You should see the bot log in and the bot show as online. If commands do not appear, wait a minute and restart Discord (Ctrl+R).

## 5. First steps in your server
1. Run `/setup`. It shows a checklist of what is set up and what is not, with a guide for each part.
2. Run `/setup topic:` and pick **Check my setup**. It finds missing permissions and broken channels.
3. Create your staff channels with **Quick setup** (the bot offers to make them) and set up logging, verification and welcome messages from the guides.
4. Try `/help` to browse every command.

## 6. Check everything works
```
node --test tests/*.test.js
```
All tests should pass. If one fails, copy the exact message and ask for help (never include your token).

## 7. Next
* Keep it running 24/7: [HOSTING.md](HOSTING.md).
* Something wrong: [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
* All commands: [COMMANDS.md](COMMANDS.md).
