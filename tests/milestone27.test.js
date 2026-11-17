const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createBackupService } = require('../src/services/backupService');
const snapMod = require('../src/serverbackup/snapshot');
const { runRestore } = require('../src/serverbackup/restore');
const flow = require('../src/serverbackup/backupFlow');

const G = '111111111111111111', G2 = '333333333333333333', ADMIN = '888888888888888881', BOT = '999999999999999991';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };
const DAY = 86400000;

// a fake server shaped like discord.js
function fakeGuild({ roles = [], channels = [], id = G } = {}) {
    const log = { rolesCreated: [], channelsCreated: [], roleEdits: [], overwriteSets: [], guildEdits: [] }; let n = 100;
    const roleMap = new Map([[id, { id, name: '@everyone', position: 0, permissions: 0n, managed: false, setPermissions: async () => {} }]]);
    for (const r of roles) roleMap.set(r.id, { managed: false, color: 0, hoist: false, mentionable: false, permissions: 0n, editable: true, ...r, edit: async (o) => { log.roleEdits.push([r.name, o]); } });
    const chMap = new Map(); const addCh = (c) => { const ch = { rawPosition: 0, topic: null, nsfw: false, rateLimitPerUser: 0, parentId: null, ...c, permissionOverwrites: { cache: new Map((c.ow ?? []).map((o) => [o.id, o])), set: async (l) => { log.overwriteSets.push([c.name, l]); } } }; chMap.set(c.id, ch); return ch; };
    for (const c of channels) addCh(c);
    const g = { id, roles: { cache: roleMap, fetch: async () => {}, create: async (o) => { if (o.name === 'BAD') throw new Error('Missing Permissions'); const r = { id: `55555555555555${++n}`, managed: false, ...o }; roleMap.set(r.id, r); log.rolesCreated.push(o); return r; } },
        channels: { cache: chMap, fetch: async () => {}, create: async (o) => { const c = addCh({ id: `66666666666666${++n}`, ...o }); const par = o.parent && chMap.get(o.parent); if (par) chMap.get(c.id).parent = par; log.channelsCreated.push(o); return c; } },
        members: { cache: new Map([[ADMIN, {}]]), me: { roles: { highest: { position: 10 } } } }, name: 'Srv', verificationLevel: 1, defaultMessageNotifications: 0, explicitContentFilter: 0, afkTimeout: 300, afkChannelId: null, systemChannelId: null,
        edit: async (o) => { log.guildEdits.push(o); } };
    return { guild: g, log };
}
const SRC = () => fakeGuild({
    roles: [{ id: '200000000000000001', name: 'Admin', position: 3, permissions: 8n, color: 255, hoist: true }, { id: '200000000000000002', name: 'Member', position: 1, permissions: 1024n }, { id: '200000000000000003', name: 'Some Bot', position: 2, managed: true }],
    channels: [{ id: '300000000000000001', name: 'Info', type: 4, rawPosition: 0 }, { id: '300000000000000002', name: 'rules', type: 0, parentId: '300000000000000001', topic: 'Be nice', rawPosition: 1, ow: [{ id: G, type: 0, allow: 0n, deny: 1024n }, { id: '200000000000000002', type: 0, allow: 1024n, deny: 0n }, { id: '777777777777777777', type: 1, allow: 1n, deny: 0n }] }, { id: '300000000000000003', name: 'Lounge', type: 2, rawPosition: 2, userLimit: 5 }, { id: '300000000000000009', name: 'a-thread', type: 11 }] });

test('snapshot: saves roles (not bots/@everyone), supported channels, overwrites by role key', () => {
    const { guild } = SRC(); const s = snapMod.buildSnapshot(guild);
    assert.deepStrictEqual(s.roles.map((r) => r.name), ['Member', 'Admin'], 'sorted by position, bot role skipped'); assert.strictEqual(s.roles[1].permissions, '8'); assert.strictEqual(s.channels.length, 3, 'thread skipped'); assert.strictEqual(s.channels[0].type, 4, 'categories first');
    const rules = s.channels.find((c) => c.name === 'rules'); assert.strictEqual(rules.parent, 'Info'); assert.strictEqual(rules.overwrites.length, 3); assert.deepStrictEqual(rules.overwrites.map((o) => o.kind).sort(), ['everyone', 'member', 'role']);
    assert.strictEqual(rules.overwrites.find((o) => o.kind === 'role').key, 'r0'); assert.doesNotThrow(() => JSON.parse(snapMod.serialize(s))); assert.ok(snapMod.parseSnapshot(snapMod.serialize(s))); assert.strictEqual(snapMod.parseSnapshot('{nope'), null); assert.strictEqual(snapMod.parseSnapshot('{"v":2}'), null);
    assert.throws(() => snapMod.serialize({ roles: new Array(251).fill({}), channels: [] }), /too big/);
});
test('plan: only missing things are created; nothing is ever deleted; fix_existing/settings are opt-in', () => {
    const snap = snapMod.buildSnapshot(SRC().guild);
    const full = snapMod.planRestore(snap, { roles: [], channels: [] }); assert.deepStrictEqual([full.summary.rolesNew, full.summary.channelsNew, full.summary.categoriesNew], [2, 3, 1]);
    const some = snapMod.planRestore(snap, { roles: [{ id: 'x', name: 'Member' }], channels: [{ id: 'c', name: 'Info', type: 4, parentName: null }, { id: 'd', name: 'rules', type: 0, parentName: 'Info' }] }); assert.deepStrictEqual([some.summary.rolesNew, some.summary.channelsNew, some.summary.rolesFix, some.summary.channelsFix], [1, 1, 0, 0]);
    const fix = snapMod.planRestore(snap, { roles: [{ id: 'x', name: 'Member' }], channels: [{ id: 'd', name: 'rules', type: 0, parentName: 'Info' }] }, { fixExisting: true, settings: true }); assert.deepStrictEqual([fix.summary.rolesFix, fix.summary.channelsFix, fix.summary.settings], [1, 1, true]);
    const same = snapMod.planRestore(snap, { roles: snap.roles.map((r) => ({ id: r.id, name: r.name })), channels: snap.channels.map((c) => ({ id: 'z', name: c.name, type: c.type, parentName: c.parent })) }); assert.deepStrictEqual([same.summary.rolesNew, same.summary.channelsNew], [0, 0]);
    assert.ok(!('delete' in full) && !('rolesToDelete' in full));
    const wrongParent = snapMod.planRestore(snap, { roles: [], channels: [{ id: 'd', name: 'rules', type: 0, parentName: 'Other' }] }); assert.ok(wrongParent.channelsToCreate.some((c) => c.name === 'rules'), 'same name under another category is a different channel');
});
test('restore: recreates roles, categories, channels with parent + overwrites; reports failures; never deletes', async () => {
    const snap = snapMod.buildSnapshot(SRC().guild); const { guild, log } = fakeGuild({ id: G2 });
    const plan = snapMod.planRestore(snap, { roles: [], channels: [] }); const res = await runRestore(guild, snap, plan, { botTop: 10 });
    assert.strictEqual(res.rolesCreated, 2); assert.strictEqual(res.channelsCreated, 3); assert.strictEqual(res.failed.length, 0);
    assert.deepStrictEqual(log.rolesCreated.map((r) => r.name), ['Member', 'Admin']); assert.strictEqual(log.rolesCreated[1].permissions, 8n); assert.ok(log.rolesCreated.every((r) => r.position <= 9), 'never above the bot');
    assert.deepStrictEqual(log.channelsCreated.map((c) => c.name), ['Info', 'rules', 'Lounge']); const rules = log.channelsCreated[1]; assert.ok(rules.parent, 'put under the new category'); assert.strictEqual(rules.topic, 'Be nice');
    assert.strictEqual(rules.permissionOverwrites.length, 2, 'member who is not in this server is skipped'); assert.ok(rules.permissionOverwrites.some((o) => o.id === G2 && o.deny === 1024n), '@everyone maps to this server'); assert.ok(rules.permissionOverwrites.some((o) => o.id.startsWith('55555555555555')), 'role maps to the new role');
    assert.strictEqual(log.channelsCreated[2].userLimit, 5); assert.deepStrictEqual(log.overwriteSets, []); assert.deepStrictEqual(log.roleEdits, []);
    const bad = JSON.parse(JSON.stringify(snap)); bad.roles.push({ key: 'r9', name: 'BAD', color: 0, hoist: false, mentionable: false, permissions: '0', position: 5 }); const f = fakeGuild({ id: G2 });
    const r2 = await runRestore(f.guild, bad, snapMod.planRestore(bad, { roles: [], channels: [] }), { botTop: 10 }); assert.strictEqual(r2.failed.length, 1); assert.match(r2.failed[0], /BAD/); assert.strictEqual(r2.channelsCreated, 3, 'one failure does not stop the rest');
});
test('restore: fix_existing and settings only when asked', async () => {
    const snap = snapMod.buildSnapshot(SRC().guild);
    const { guild, log } = fakeGuild({ id: G2, roles: [{ id: '400000000000000001', name: 'Member', position: 1, permissions: 0n }], channels: [{ id: '500000000000000001', name: 'Info', type: 4 }, { id: '500000000000000002', name: 'rules', type: 0, parentId: '500000000000000001' }] });
    guild.channels.cache.get('500000000000000002').parent = guild.channels.cache.get('500000000000000001');
    let res = await runRestore(guild, snap, snapMod.planRestore(snap, { roles: [{ id: '4', name: 'Member' }], channels: [{ id: '5', name: 'Info', type: 4, parentName: null }, { id: '6', name: 'rules', type: 0, parentName: 'Info' }] }));
    assert.strictEqual(res.rolesFixed + res.channelsFixed, 0); assert.deepStrictEqual(log.guildEdits, []); assert.strictEqual(res.rolesCreated, 1, 'only Admin was missing');
    res = await runRestore(guild, snap, snapMod.planRestore(snap, { roles: [{ id: '4', name: 'Member' }, { id: '5', name: 'Admin' }], channels: [{ id: '5', name: 'Info', type: 4, parentName: null }, { id: '6', name: 'rules', type: 0, parentName: 'Info' }, { id: '7', name: 'Lounge', type: 2, parentName: null }] }, { fixExisting: true, settings: true }));
    assert.ok(res.rolesFixed >= 1 && res.channelsFixed >= 1 && res.settings); assert.strictEqual(log.guildEdits.length, 1); assert.strictEqual(log.guildEdits[0].verificationLevel, 1);
});

test('service: limits, isolation between servers, auto pruning, one claim per period', () => {
    let t = 1_000_000; const s = createBackupService(fresh(), { now: () => t }); const mk = (g, auto = false) => s.create(g, { name: 'x', by: ADMIN, data: '{"v":1,"roles":[],"channels":[]}', roles: 0, channels: 0, auto });
    const ids = []; for (let i = 0; i < 10; i++) ids.push(mk(G)); assert.throws(() => mk(G), /10 backups/); assert.ok(mk(G2), 'other server has its own limit');
    assert.strictEqual(s.getMeta(G2, ids[0]), null, 'cannot read another server\'s backup'); assert.strictEqual(s.getData(G2, ids[0]), null); assert.ok(!s.remove(G2, ids[0])); assert.ok(s.remove(G, ids[0])); assert.strictEqual(s.list(G).length, 9);
    const a = []; for (let i = 0; i < 5; i++) a.push(mk(G, true)); assert.strictEqual(s.list(G).filter((b) => b.auto).length, 3, 'only the latest 3 automatic ones stay'); assert.strictEqual(s.list(G).filter((b) => !b.auto).length, 9, 'manual ones untouched');
    assert.ok(!s.claimAuto(G)); assert.throws(() => s.setAutoDays(G, 31), /0/); s.setAutoDays(G, 2); assert.ok(!s.claimAuto(G, t + DAY), 'not yet 2 days since enabling'); assert.ok(s.claimAuto(G, t + 2 * DAY)); assert.ok(!s.claimAuto(G, t + 2 * DAY + 1000), 'once per period'); assert.ok(s.claimAuto(G, t + 4 * DAY + 5000));
    s.setAutoDays(G, 0); assert.ok(!s.claimAuto(G, t + 99 * DAY)); assert.deepStrictEqual(s.autoGuilds(), []);
});

function clientWith(guild) { const db = fresh(); let t = 5_000_000; const backups = createBackupService(db, { now: () => (t += 10) }); return { client: { user: { id: BOT }, guilds: { cache: new Map([[guild.id, guild]]) }, services: { backups } }, backups }; }
test('flow: takeBackup saves; the automatic tick works once per period', async () => {
    const { guild } = SRC(); const { client, backups } = clientWith(guild); const id = await flow.takeBackup(client, guild, { name: 'Test', by: ADMIN }); const m = backups.getMeta(G, id); assert.deepStrictEqual([m.roles, m.channels, m.name], [2, 3, 'Test']);
    backups.setAutoDays(G, 1); const now = Date.now() + 3 * DAY; await flow.autoBackupTick(client, now); await flow.autoBackupTick(client, now + 1000); assert.strictEqual(backups.list(G).filter((b) => b.auto).length, 1);
});
test('flow: confirm button is for the same admin only, expires, and runs once', async () => {
    const { guild, log } = fakeGuild({ id: G }); const snap = snapMod.buildSnapshot(SRC().guild); const { client, backups } = clientWith(guild);
    const bid = backups.create(G, { name: 'B', by: ADMIN, data: snapMod.serialize(snap), roles: 2, channels: 3 });
    const click = (user, { perm = true, token } = {}) => { const r = []; return { r, client, customId: `sb:go:${token}`, user: { id: user, username: 'u' }, guildId: G, guild, memberPermissions: { has: () => perm }, channel: { send: async () => {} }, reply: async (o) => r.push(o), update: async (o) => r.push(o), editReply: async (o) => r.push(o) }; };
    const put = (extra = {}) => { const token = `tok${Math.random().toString(16).slice(2)}`; flow.pending.set(token, { userId: ADMIN, guildId: G, backupId: bid, fixExisting: false, settings: false, expires: Date.now() + 60000, ...extra }); return token; };
    let tok = put(); let i = click('999999999999999990', { token: tok }); await flow.handleBackupComponent(i); assert.match(i.r[0].content, /Only the person/); assert.strictEqual(log.channelsCreated.length, 0);
    i = click(ADMIN, { token: tok, perm: false }); await flow.handleBackupComponent(i); assert.match(i.r[0].content, /Administrator/);
    tok = put({ expires: Date.now() - 1 }); i = click(ADMIN, { token: tok }); await flow.handleBackupComponent(i); assert.match(i.r[0].content, /expired/); assert.strictEqual(log.channelsCreated.length, 0);
    tok = put(); i = click(ADMIN, { token: tok }); await flow.handleBackupComponent(i); assert.ok(i.r.some((x) => /Restore finished/.test(x.content ?? ''))); assert.strictEqual(log.channelsCreated.length, 3); assert.strictEqual(flow.running.size, 0);
    i = click(ADMIN, { token: tok }); await flow.handleBackupComponent(i); assert.match(i.r[0].content, /expired/, 'a used button cannot run again'); assert.strictEqual(log.channelsCreated.length, 3);
    tok = put(); const c = click(ADMIN, { token: tok }); c.customId = `sb:no:${tok}`; await flow.handleBackupComponent(c); assert.match(c.r[0].content, /cancelled/);
});
test('command, help, guide', () => {
    const c = require('../src/commands/admin/serverbackup'); assert.strictEqual(c.data.name, 'serverbackup'); const { CATEGORIES } = require('../src/help/catalog'); assert.ok(CATEGORIES.some((x) => x.commands.includes('serverbackup')));
});
