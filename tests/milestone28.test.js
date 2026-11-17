const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function commandNames() {
    const names = [];
    (function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) names.push(require(p).data.name); } })(path.join(ROOT, 'src', 'commands'));
    return names;
}

test('every command in /help is a real command and every real command is in /help', () => {
    const { CATEGORIES } = require('../src/help/catalog'); const listed = CATEGORIES.flatMap((c) => c.commands); const real = commandNames();
    assert.deepStrictEqual(listed.filter((n) => !real.includes(n)), [], 'listed in /help but there is no such command');
    assert.deepStrictEqual(real.filter((n) => !listed.includes(n)), [], 'a real command is missing from /help');
    assert.strictEqual(new Set(real).size, real.length, 'two files define the same command name'); assert.ok(real.length <= 100, 'Discord allows 100 slash commands');
});
test('/ping exists and answers with the round trip', async () => {
    const ping = require('../src/commands/utility/ping'); assert.strictEqual(ping.data.name, 'ping'); const calls = [];
    await ping.execute({ createdTimestamp: 1000, client: { ws: { ping: 42 } }, reply: async (o) => calls.push(['reply', o]), fetchReply: async () => ({ createdTimestamp: 1180 }), editReply: async (o) => calls.push(['edit', o]) });
    assert.match(calls[1][1].content, /180 ms/); assert.match(calls[1][1].content, /42 ms/); assert.deepStrictEqual(calls[1][1].allowedMentions, { parse: [] });
});
test('docs: all guides exist and COMMANDS.md matches the catalog', () => {
    for (const f of ['README.md', 'docs/SETUP.md', 'docs/HOSTING.md', 'docs/TROUBLESHOOTING.md', 'docs/COMMANDS.md']) assert.ok(read(f).length > 500, f);
    const { buildCommandsDoc } = require('../scripts/generate-docs'); assert.strictEqual(read('docs/COMMANDS.md').replace(/\r\n/g, '\n'), buildCommandsDoc(), 'docs/COMMANDS.md is out of date: run  node scripts/generate-docs.js');
    assert.match(read('docs/COMMANDS.md'), new RegExp(`${commandNames().length} slash commands`));
});
test('docs never contain anything that looks like a real token or key', () => {
    for (const f of ['README.md', 'docs/SETUP.md', 'docs/HOSTING.md', 'docs/TROUBLESHOOTING.md', 'scripts/update-linux.sh', 'scripts/start-incomu.bat', 'ecosystem.config.js']) {
        const t = read(f); assert.ok(!/[MNO][A-Za-z\d_-]{23,25}\.[\w-]{6}\.[\w-]{27,}/.test(t), `${f}: looks like a Discord token`); assert.ok(!/AIza[\w-]{30,}/.test(t), `${f}: looks like a Google key`);
    }
});
test('docs mention the important safety rules', () => {
    const h = read('docs/HOSTING.md'); for (const w of ['Node.js 24', 'pm2 save', 'pm2 startup', 'ufw', 'never run the bot as root', 'Never run the same bot token', 'data/backups', 'chmod 600']) assert.ok(h.toLowerCase().includes(w.toLowerCase()), w);
    assert.match(read('docs/TROUBLESHOOTING.md'), /Maximum number of application commands/); assert.match(read('docs/SETUP.md'), /Message Content Intent/);
});
test('pm2 config is valid and update script is safe', () => {
    const eco = require('../ecosystem.config.js').apps[0]; assert.strictEqual(eco.name, 'incomu'); assert.strictEqual(eco.script, 'index.js'); assert.ok(eco.autorestart && eco.max_restarts > 0 && /M$/.test(eco.max_memory_restart));
    const sh = read('scripts/update-linux.sh'); assert.match(sh, /set -euo pipefail/); assert.ok(sh.indexOf('cp -a data') < sh.indexOf('unzip'), 'database is copied before unpacking'); assert.ok(sh.indexOf('node --test') < sh.lastIndexOf('pm2 start'), 'tests run before the bot starts again'); assert.match(sh, /exit 1/);
    const bat = read('scripts/start-incomu.bat'); assert.match(bat, /node index\.js/); assert.match(bat, /goto loop/);
});
test('the hosting guide is inside /setup', () => {
    const { GUIDES } = require('../src/setup/guides'); const g = GUIDES.find((x) => x.id === 'hosting'); assert.ok(g); assert.match(g.text, /pm2/); assert.match(g.text, /docs\/HOSTING\.md/);
});
