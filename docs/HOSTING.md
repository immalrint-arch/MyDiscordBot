# Running Incomu 24/7

A Discord bot is only online while the program is running. Close the window or shut down the computer and the bot goes offline. To keep it online all the time you need three things:

1. A computer that is **always on** and connected to the internet.
2. Something that **restarts the bot** after a crash or a reboot.
3. A place for the `data` folder that **never gets wiped**. Incomu keeps everything (settings, cases, levels, tickets) in `data/bot.sqlite`.

## 1. Where should it run?

| Option | Cost (rough) | Good for | Watch out for |
|---|---|---|---|
| **Your own PC** | free | Testing and learning | Offline whenever the PC sleeps, restarts or is off |
| **Old PC, laptop or Raspberry Pi at home** | electricity | A hobby server, no monthly bill | Home internet and power cuts, you maintain it |
| **Cheap VPS (recommended)** | about $4 to $12 per month | Real 24/7 use | You manage a Linux server (this guide walks you through it) |
| **Managed bot host** | varies, often priced per GB of memory | No server to manage | Costs more for always-on use |
| **"Free" hosting** | $0 | Not recommended for Incomu | Many free plans sleep when nobody visits a web page, expire, or reset the disk. A bot has no web page, so it can disappear without any error, and a reset disk would delete your database |

Prices change often. The ranges above are rough numbers from a September 2026 comparison article, so check the provider's own page before paying. Choose a plan that says **always on**, has a **disk that stays**, and gives you at least **1 GB of memory**.

**What Incomu needs:** Node.js **24** (it uses the built-in `node:sqlite`), a disk that persists, and outbound internet. It does not need any open ports.

## 2. Keeping it running on Windows (your own PC)

Good enough for a small server while you learn.

1. In Windows **Settings → System → Power**, set sleep to **Never** (when plugged in).
2. Use the helper script `scripts\start-incomu.bat`. It starts the bot and starts it again 10 seconds after any crash.
3. To start it automatically at login: open **Task Scheduler → Create Basic Task**. Trigger: **When I log on**. Action: **Start a program**, and pick `scripts\start-incomu.bat`. Set **Start in** to your project folder.
4. Windows Update can restart the PC. Set **Active hours** so it does not restart while people use your server.

## 3. Setting up a VPS (Ubuntu 24.04), step by step

Each box is something you type. Lines starting with `#` are comments.

### 3.1 Create the server
1. Buy a small VPS with **Ubuntu 24.04 LTS** and 1 GB or more of memory.
2. The provider shows you an IP address and a password or SSH key. Write the IP down. In this guide it is `203.0.113.10`.
3. From Windows PowerShell connect with `ssh root@203.0.113.10`. Type `yes` if it asks about the fingerprint.

### 3.2 Make a normal user (never run the bot as root)
```bash
adduser incomu                 # choose a strong password
usermod -aG sudo incomu
rsync --archive --chown=incomu:incomu ~/.ssh /home/incomu   # only if you logged in with a key
exit
```
Log in again with `ssh incomu@203.0.113.10`.

### 3.3 Update the system and turn on the firewall
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y unzip ufw unattended-upgrades
sudo ufw allow OpenSSH
sudo ufw enable
```
The bot makes outgoing connections only, so no other port needs opening.

### 3.4 Install Node.js 24
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v          # should print v24.something
```
If that command stops working, open nodesource.com for the current instructions.

### 3.5 Upload the project
On your **Windows PC**, zip your project folder **without** `node_modules` and **without** `.env`, then run in PowerShell:
```powershell
scp C:\Users\YOU\Documents\incomu-project.zip incomu@203.0.113.10:~/
```
Back on the server:
```bash
mkdir -p ~/incomu && cd ~/incomu
unzip ~/incomu-project.zip
nano .env        # type your values, save with Ctrl+O, Enter, then Ctrl+X
chmod 600 .env   # only you can read it
```
Your `.env` needs the same lines as on your PC: `DISCORD_TOKEN=...` plus the other lines you already use to deploy commands (and `OWNER_IDS=` if you use it). **Type the token yourself on the server. Never paste it into a chat, a screenshot or an email.**

### 3.6 Install and test
```bash
npm install --omit=dev
node src/deploy-commands.js      # only when commands changed
node index.js                    # the bot should come online. Stop it with Ctrl+C
```

### 3.7 Keep it alive with pm2
pm2 restarts the bot if it crashes and starts it after a reboot.
```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup                      # it prints a line that starts with "sudo env PATH=..."
                                 # copy that exact line, run it, then run: pm2 save
```
Useful pm2 commands:
```bash
pm2 status                       # is it online?
pm2 logs incomu                  # live log (Ctrl+C to leave)
pm2 restart incomu
pm2 stop incomu
```
Now reboot the server (`sudo reboot`), wait a minute, log in and run `pm2 status`. If the bot is online without you doing anything, it works.

*Alternative without pm2:* a systemd service. It does the same job and is built into Ubuntu. Create `/etc/systemd/system/incomu.service` with `sudo nano`:
```ini
[Unit]
Description=Incomu Discord bot
After=network-online.target
Wants=network-online.target

[Service]
User=incomu
WorkingDirectory=/home/incomu/incomu
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```
Then `sudo systemctl enable --now incomu`, and read the log with `journalctl -u incomu -f`. Use pm2 **or** systemd, never both.

## 4. Updating the bot safely
A new milestone zip only **adds and replaces** files. It never deletes old ones. So when a milestone says "delete these files", do that first (an old leftover file can crash the bot or push you over Discord's 100-command limit).

Easy way: upload the zip, then on the server run `bash scripts/update-linux.sh ~/incomu-milestone28.zip`. The script stops the bot, makes a copy of your database, unzips, installs packages, runs the tests and starts the bot again. If the tests fail it does **not** start the new version and tells you where the database copy is.

Do it by hand:
```bash
pm2 stop incomu
cp data/bot.sqlite ~/bot-before-update.sqlite
unzip -o ~/incomu-milestone28.zip
npm install --omit=dev
node --test tests/*.test.js
node src/deploy-commands.js
pm2 start incomu
```

## 5. Backups
* Incomu saves a daily database backup in `data/backups` (the last 7). Use `/owner backup` for one right now.
* Those files live **on the same server**. If the server is lost, so are they. Pull a copy to your PC now and then. In PowerShell:
  ```powershell
  scp -r incomu@203.0.113.10:~/incomu/data/backups C:\Users\YOU\Documents\incomu-backups
  ```
* Most VPS providers sell **snapshots** (a copy of the whole server) for a small fee. Worth turning on.
* `/serverbackup create` saves your server's roles and channels. That is separate from the database and worth doing before big changes.

## 6. Moving from your PC to a VPS
1. Stop the bot on your PC.
2. Copy `data/bot.sqlite` to the server's `data` folder. If you also see `bot.sqlite-wal` and `bot.sqlite-shm`, copy those too (or use a file from `data/backups`, which is a single clean file).
3. Start the bot on the server.
4. **Never run the same bot token in two places at once.** Both copies would answer every command.

## 7. Keeping it safe
* The token lives only in `.env`. Never upload `.env` to GitHub, never share it, never show it in a screenshot.
* If the token ever leaks: Discord Developer Portal → your app → **Bot → Reset Token**, then put the new one in `.env` and restart.
* Use a normal user (not root), keep the firewall on, run `sudo apt update && sudo apt upgrade -y` every few weeks and reboot after kernel updates.
* Set `OWNER_IDS` and turn on error alerts (`/owner`) so the bot tells you when something goes wrong.
* Check on it: `/botinfo` shows uptime and memory.

## 8. When something goes wrong
| Problem | Likely cause and fix |
|---|---|
| Bot offline after a reboot | `pm2 startup` was not run, or `pm2 save` was forgotten. Run both again |
| `Cannot find module ...` | Run `npm install --omit=dev` in the project folder |
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node is too old. `node -v` must show v24 or newer |
| `ExperimentalWarning: SQLite is an experimental feature` | Harmless warning. The bot works |
| Bot crashes again and again | `pm2 logs incomu --lines 100` and read the first error line |
| Commands missing in Discord | Run `node src/deploy-commands.js` (wait a minute, restart Discord) |
| `Maximum number of application commands reached (100)` | Old command files are left over. See `docs/TROUBLESHOOTING.md` |
| Disk full | `df -h`. Delete old logs with `pm2 flush` and old files in `data/backups` |
| Server runs out of memory | Pick a plan with more memory. `ecosystem.config.js` restarts the bot if it grows past 400 MB |
