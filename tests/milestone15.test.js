const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../src/help/catalog');
const helpFlow = require('../src/help/helpFlow');
const { evaluate, progressBar } = require('../src/setup/status');
const { GUIDES, BY_ID } = require('../src/setup/guides');
const health = require('../src/setup/health');
const { planQuick } = require('../src/setup/quick');
const setupFlow = require('../src/setup/setupFlow');

// ---- the real command list (so guides and examples cannot drift from the code) ----
const jsons = [];
const root = path.join(__dirname, '..', 'src', 'commands');
for (const dir of fs.readdirSync(root)) for (const file of fs.readdirSync(path.join(root, dir))) if (file.endsWith('.js')) jsons.push(require(path.join(root, dir, file)).data.toJSON());
const byName = new Map(jsons.map((j) => [j.name, j]));
const json = (x) => JSON.stringify(x);

// Finds the sub-command (or group + sub) options for a typed command, or null if it does not exist.
function resolve(words) {
    const cmd = byName.get(words[0]); if (!cmd) return null;
    let options = cmd.options ?? []; let used = 1;
    while (words[used] && options.some((o) => (o.type === 1 || o.type === 2) && o.name === words[used])) { options = options.find((o) => o.name === words[used]).options ?? []; used++; }
    return { options, used };
}
function checkTyped(text, where) {
    if (!/^\/[a-z]/.test(text)) return;
    const tokens = text.split(/\s{2,}|\s\(/)[0].trim().split(/\s+/);
    const words = []; const opts = [];
    for (const t of tokens) { if (/^[a-z_-]+:/.test(t)) opts.push(t.split(':')[0]); else if (!opts.length) words.push(t.replace(/^\//, '')); }
    const found = resolve(words); assert.ok(found, `${where}: command not found: ${text}`);
    assert.strictEqual(words.length, found.used, `${where}: unknown sub-command in "${text}"`);
    for (const opt of opts) assert.ok(found.options.some((o) => o.name === opt), `${where}: option "${opt}" does not exist in "${text}"`);
}

test('guides: every /command written in backticks really exists with real options', () => {
    let checked = 0;
    for (const g of GUIDES) for (const [, code] of g.text.matchAll(/`([^`\n]+)`/g)) { if (code.startsWith('/') && /^\/[a-z]/.test(code)) { checkTyped(code, `guide ${g.id}`); checked++; } }
    assert.ok(checked > 40, `expected many checked commands, got ${checked}`);
});
test('guides: unique ids, text fits, systems exist', () => {
    const { SYSTEMS } = require('../src/setup/status');
    assert.strictEqual(new Set(GUIDES.map((g) => g.id)).size, GUIDES.length); assert.strictEqual(BY_ID.size, GUIDES.length);
    for (const g of GUIDES) { assert.ok(g.title && g.emoji && g.text.length > 200, g.id); for (const id of g.systems) assert.ok(SYSTEMS.some((s) => s.id === id), `${g.id} -> ${id}`); }
    assert.ok(GUIDES.length <= 72); // + 3 fixed entries; the menu is split into rows of 25 (see tests/milestone24)
});
test('help examples and next-step commands are real', () => {
    for (const [name, list] of Object.entries(catalog.EXAMPLES)) { assert.ok(byName.has(name), `example for unknown /${name}`); for (const ex of [].concat(list)) checkTyped(ex, `example ${name}`); }
    const { SYSTEMS } = require('../src/setup/status');
    const snap = emptySnap();
    for (const item of evaluate(snap).items) if (item.next?.startsWith('/')) checkTyped(item.next, `next ${item.id}`);
});

// ---- help ----
const index = catalog.buildIndex(jsons);
const helpClient = { commands: new Map(jsons.map((j) => [j.name, { data: { toJSON: () => j } }])), services: { guildSettings: { getSettings: () => ({}) }, textCommands: { getConfig: () => ({}) } } };
test('help: every command is in a real category (none left in Other)', () => {
    assert.ok(!index.categories.some((c) => c.id === 'other'), `unmapped: ${index.categories.find((c) => c.id === 'other')?.commands}`);
    const all = index.categories.flatMap((c) => c.commands); assert.strictEqual(new Set(all).size, all.length); assert.strictEqual(all.length, jsons.length);
});
test('help: search exact, sub-command, words, synonyms, typos', () => {
    assert.strictEqual(catalog.search(index, '/ban').exact.command.name, 'ban');
    assert.strictEqual(catalog.search(index, 'antinuke enable').exact.sub.name.endsWith('enable'), true);
    assert.ok(catalog.search(index, 'raid').matches.includes('antinuke')); assert.ok(catalog.search(index, 'mute').matches.includes('timeout'));
    assert.deepStrictEqual(catalog.search(index, 'music').matches, []);
    assert.ok(catalog.search(index, 'bna').close.includes('ban')); assert.deepStrictEqual(catalog.search(index, '').matches, []);
});
test('help: permission labels', () => {
    const { PermissionFlagsBits: P } = require('discord.js');
    assert.ok(catalog.permissionLabels(null).length === 0 || Array.isArray(catalog.permissionLabels(null)));
    const labels = catalog.permissionLabels(String(P.BanMembers)); assert.ok(labels.join(' ').toLowerCase().includes('ban'));
});
test('help: pages are well formed and within Discord limits', () => {
    const home = helpFlow.homePayload(helpClient, 'u1', { prefix: '!' }); assert.ok(json(home).includes('/setup'));
    for (const c of index.categories) assert.strictEqual(helpFlow.categoryPayload(helpClient, 'u1', c.id, 0).embeds.length, 1);
    for (const j of jsons) { const p = helpFlow.commandPayload(helpClient, 'u1', catalog.search(index, j.name).exact); assert.ok(p.embeds.length === 1, j.name); assert.ok(json(p).length < 6000, `${j.name} help too long`); }
    const s = helpFlow.searchPayload(helpClient, 'u1', 'raid', catalog.search(index, 'raid')); assert.ok(json(s).includes('antinuke'));
});
test('help: only the requester can use the menu', async () => {
    const replies = []; const i = { customId: 'hp:u1:menu', user: { id: 'u2' }, values: ['moderation'], client: { }, reply: async (x) => replies.push(x), update: async () => assert.fail('must not update') };
    await helpFlow.handleHelpComponent(i); assert.strictEqual(replies.length, 1); assert.ok(replies[0].content);
});

// ---- setup: status ----
function emptySnap() {
    return { logGeneralChannelId: null, logCategoriesSet: 0, appealChannelId: null, dmOnAction: false, antinuke: { enabled: false, alertChannelId: null, trusted: 0 }, automod: { enabled: false, rulesOn: 0 },
        verification: {}, quarantine: {}, tickets: {}, reports: {}, textCommands: {}, welcome: {}, goodbye: {}, autoroles: 0, rolePanels: 0, rolePanelsPublished: 0, leveling: {}, levelRoles: 0,
        confessions: {}, suggestionsChannelId: null, starboard: {}, tempVoice: {}, quotes: {} };
}
test('status: empty server = nothing done; essentials have next commands', () => {
    const r = evaluate(emptySnap()); assert.strictEqual(r.essentials.done, 0); assert.strictEqual(r.essentials.total, 5);
    for (const i of r.items.filter((x) => x.essential)) { assert.strictEqual(i.state, 'todo'); assert.ok(i.next, i.id); }
});
test('status: states move to partial and done', () => {
    const s = emptySnap(); s.logGeneralChannelId = '1'; s.appealChannelId = '2'; s.antinuke = { enabled: true, alertChannelId: null, trusted: 0 }; s.quarantine = { roleId: '3' };
    const r = evaluate(s); const st = (id) => r.items.find((i) => i.id === id).state;
    assert.strictEqual(st('logs'), 'done'); assert.strictEqual(st('appeals'), 'done'); assert.strictEqual(st('antinuke'), 'partial'); assert.strictEqual(st('quarantine'), 'partial'); assert.strictEqual(r.essentials.done, 2);
    s.antinuke.alertChannelId = '4'; s.quarantine.channelId = '5'; s.automod = { enabled: true, rulesOn: 2 };
    assert.strictEqual(evaluate(s).essentials.done, 5);
});
test('status: progress bar', () => { assert.strictEqual(progressBar(0, 5).length, progressBar(5, 5).length); assert.notStrictEqual(progressBar(0, 5), progressBar(5, 5)); });

// ---- setup: health pure parts ----
test('health: permission check lists what is missing', () => {
    const bad = health.checkPermissions(() => false); assert.ok(bad.length > 3); assert.ok(bad.some((x) => !x.ok));
    assert.ok(health.checkPermissions(() => true).every((x) => x.ok));
    assert.deepStrictEqual(health.rolesAboveMe([{ id: 'e', position: 0 }, { id: 'a', position: 5 }, { id: 'b', position: 2 }, { id: 'm', position: 9, managed: true }], 3, 'e').map((r) => r.id), ['a']);
});

// ---- setup: quick plan ----
test('quick: plan only lists what is missing', () => {
    const s = emptySnap(); assert.deepStrictEqual(planQuick(s).map((x) => x.id), ['logs', 'appeals', 'reports', 'quarantine', 'alerts']);
    s.logGeneralChannelId = '1'; s.appealChannelId = '2'; s.reports = { channelId: '3' }; s.quarantine = { roleId: '4', channelId: '5' }; s.antinuke = { enabled: false, alertChannelId: '6' };
    assert.deepStrictEqual(planQuick(s), []);
    s.quarantine = { roleId: '4' }; assert.deepStrictEqual(planQuick(s).map((x) => x.id), ['quarantine']);
});

// ---- setup: flows with a fake client ----
function fakeClient(overrides = {}) {
    const svc = (v) => new Proxy({}, { get: () => () => v });
    const services = { guildSettings: { getSettings: () => ({}) }, logConfig: { listChannels: () => ({}) }, antinukeConfig: { getEffective: () => ({}) }, automod: { getConfig: () => ({ enabled: false, rules: {} }) },
        roles: { listPanels: () => [], listAutoRoles: () => [] }, ...overrides };
    return { services: new Proxy(services, { get: (t, k) => t[k] ?? svc({}) }) };
}
const fakeGuild = { id: 'g1', name: 'Test Server' };
test('setup flow: checklist, every guide and health render with valid sizes', async () => {
    const client = fakeClient();
    const o = setupFlow.overviewPayload(client, fakeGuild, 'u1'); assert.ok(json(o).includes('Quick setup')); assert.ok(json(o).includes('/logs set-all') || json(o).includes('logs'));
    assert.ok(o.components.length <= 5);
    for (const g of GUIDES) { const p = setupFlow.guidePayload(client, fakeGuild, 'u1', g.id, 0); assert.ok(p.embeds.length === 1, g.id); }
    assert.ok(json(setupFlow.quickPlanPayload(client, fakeGuild, 'u1')).includes('Create it'));
    assert.ok(json(setupFlow.guidePayload(client, fakeGuild, 'u1', 'nope', 0)).includes('Incomu setup'));
});
test('setup flow: only the owner of the panel with Manage Server can use it', async () => {
    const { PermissionFlagsBits } = require('discord.js');
    const replies = []; const base = { customId: 'st:u1:go:overview:0', client: fakeClient(), guild: fakeGuild, reply: async (x) => replies.push(x), update: async () => replies.push('updated') };
    await setupFlow.handleSetupComponent({ ...base, user: { id: 'u2' }, memberPermissions: { has: () => true } });
    assert.match(replies[0].content, /someone else/);
    await setupFlow.handleSetupComponent({ ...base, user: { id: 'u1' }, memberPermissions: { has: () => false } });
    assert.match(replies[1].content, /Manage Server/);
    await setupFlow.handleSetupComponent({ ...base, user: { id: 'u1' }, memberPermissions: { has: () => true } });
    assert.strictEqual(replies[2], 'updated');
});
test('setup flow: quick setup without permissions creates nothing', async () => {
    let created = 0;
    const guild = { id: 'g2', name: 'x', members: { fetchMe: async () => ({ permissions: { has: () => false } }) }, channels: { create: async () => { created++; } }, roles: { create: async () => { created++; } } };
    const out = await setupFlow.quickRun(fakeClient(), guild, 'u1', 'tester'); assert.strictEqual(created, 0); assert.ok(json(out).includes('Manage Channels'));
    assert.strictEqual(setupFlow.running.size, 0);
});
