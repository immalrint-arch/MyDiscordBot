const test = require('node:test');
const assert = require('node:assert');
const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');
const { createRoleService, RoleServiceError } = require('../src/services/roleService');
const { createChannelService, ChannelServiceError } = require('../src/services/channelService');
const { createWelcomeService } = require('../src/services/welcomeService');
const { createQuoteService } = require('../src/services/quoteService');
const { planRoleChange, roleProblem, moderatorRoleProblem, parseEmoji, reactionKey } = require('../src/roles/roleRules');
const { selectAutoRoles } = require('../src/roles/autoRoles');
const { renderTemplate, ordinal, parseColor } = require('../src/welcome/template');
const rules = require('../src/channels/channelRules');
const { cleanQuoteText, parseInline, wrapPieces } = require('../src/quotes/quoteText');

const G = '111111111111111111', U = '222222222222222222';
const R1 = '333333333333333331', R2 = '333333333333333332', R3 = '333333333333333333';
const fresh = () => { const db = openDatabase(':memory:'); runMigrations(db, MIGRATIONS_DIR); return db; };

// ---------- role rules ----------
test('panel: toggling adds then removes', () => {
    const base = { panelRoles: [R1, R2, R3], maxRoles: 0, allowRemove: true };
    assert.deepStrictEqual(planRoleChange({ ...base, held: [], action: { type: 'toggle', roleId: R1 } }), { add: [R1], remove: [], error: null });
    assert.deepStrictEqual(planRoleChange({ ...base, held: [R1], action: { type: 'toggle', roleId: R1 } }), { add: [], remove: [R1], error: null });
});
test('panel: max 1 swaps the old role for the new one', () => {
    const r = planRoleChange({ held: [R1], panelRoles: [R1, R2], action: { type: 'toggle', roleId: R2 }, maxRoles: 1, allowRemove: true });
    assert.deepStrictEqual([r.add, r.remove, r.error], [[R2], [R1], null]);
});
test('panel: max 2 refuses a third role', () => {
    const r = planRoleChange({ held: [R1, R2], panelRoles: [R1, R2, R3], action: { type: 'toggle', roleId: R3 }, maxRoles: 2, allowRemove: true });
    assert.ok(r.error); assert.deepStrictEqual(r.add, []);
});
test('panel: no-removal panels never take roles away', () => {
    const r = planRoleChange({ held: [R1], panelRoles: [R1, R2], action: { type: 'toggle', roleId: R1 }, allowRemove: false });
    assert.ok(r.error); assert.deepStrictEqual(r.remove, []);
    const swap = planRoleChange({ held: [R1], panelRoles: [R1, R2], action: { type: 'toggle', roleId: R2 }, maxRoles: 1, allowRemove: false });
    assert.ok(swap.error); assert.deepStrictEqual(swap.remove, []);
});
test('panel: dropdown selection adds and removes in one go and ignores foreign roles', () => {
    const r = planRoleChange({ held: [R1], panelRoles: [R1, R2], action: { type: 'select', roleIds: [R2, R3] }, maxRoles: 0, allowRemove: true });
    assert.deepStrictEqual([r.add, r.remove], [[R2], [R1]]);
    const tooMany = planRoleChange({ held: [], panelRoles: [R1, R2, R3], action: { type: 'select', roleIds: [R1, R2, R3] }, maxRoles: 2, allowRemove: true });
    assert.ok(tooMany.error);
});
test('panel: a role that left the panel is refused', () => {
    assert.ok(planRoleChange({ held: [], panelRoles: [R1], action: { type: 'toggle', roleId: R3 } }).error);
});

const perms = (...names) => ({ has: (n) => names.includes(n) });
test('role problems: managed, too high, everyone, powerful', () => {
    const ok = { id: R1, managed: false, position: 2, permissions: perms() };
    assert.strictEqual(roleProblem({ role: ok, guildId: G, botHighestPosition: 5, forbidDangerous: true }), null);
    assert.match(roleProblem({ role: { ...ok, managed: true }, guildId: G, botHighestPosition: 5 }), /managed/);
    assert.match(roleProblem({ role: { ...ok, position: 5 }, guildId: G, botHighestPosition: 5 }), /highest role/);
    assert.match(roleProblem({ role: { ...ok, id: G }, guildId: G, botHighestPosition: 5 }), /everyone/);
    assert.match(roleProblem({ role: { ...ok, permissions: perms('Administrator') }, guildId: G, botHighestPosition: 5, forbidDangerous: true }), /powerful/);
    assert.strictEqual(roleProblem({ role: { ...ok, permissions: perms('Administrator') }, guildId: G, botHighestPosition: 5 }), null); // allowed when a moderator hands it out
    assert.ok(roleProblem({ role: null, guildId: G, botHighestPosition: 5 }));
});
test('moderators cannot manage roles at or above their own (owner can)', () => {
    const role = { position: 4 };
    assert.ok(moderatorRoleProblem({ role, guildOwnerId: 'o', actorId: 'm', actorHighestPosition: 4 }));
    assert.strictEqual(moderatorRoleProblem({ role, guildOwnerId: 'o', actorId: 'm', actorHighestPosition: 5 }), null);
    assert.strictEqual(moderatorRoleProblem({ role, guildOwnerId: 'o', actorId: 'o', actorHighestPosition: 0 }), null);
});
test('emoji parsing', () => {
    assert.strictEqual(parseEmoji('🎮').key, '🎮');
    assert.strictEqual(parseEmoji('<:cat:123456789012345678>').key, '123456789012345678');
    assert.strictEqual(parseEmoji('<a:cat:123456789012345678>').custom, true);
    assert.strictEqual(parseEmoji('hello'), null);
    assert.strictEqual(parseEmoji('1'), null);
    assert.strictEqual(parseEmoji(''), null);
    assert.strictEqual(reactionKey({ id: '5', name: 'x' }), '5');
    assert.strictEqual(reactionKey({ id: null, name: '🎮' }), '🎮');
});
test('auto roles choose by target and timing', () => {
    const cfg = [{ roleId: R1, target: 'humans', timing: 'join' }, { roleId: R2, target: 'bots', timing: 'join' }, { roleId: R3, target: 'all', timing: 'verified' }];
    assert.deepStrictEqual(selectAutoRoles(cfg, { isBot: false, timing: 'join' }), [R1]);
    assert.deepStrictEqual(selectAutoRoles(cfg, { isBot: true, timing: 'join' }), [R2]);
    assert.deepStrictEqual(selectAutoRoles(cfg, { isBot: false, timing: 'verified' }), [R3]);
});

// ---------- role service ----------
test('role service: panels, options, limits and cleanup', () => {
    const db = fresh(); const s = createRoleService(db);
    const panel = s.createPanel(G, { name: 'Games', mode: 'button', title: 'Games' });
    assert.throws(() => s.createPanel(G, { name: 'games', mode: 'button' }), RoleServiceError); // names ignore capitals
    s.addOption(panel, { roleId: R1, label: 'One', emoji: '🎮' });
    assert.throws(() => s.addOption(panel, { roleId: R1, label: 'Again' }), RoleServiceError);
    assert.throws(() => s.addOption(panel, { roleId: R2, label: 'Same emoji', emoji: '🎮' }), RoleServiceError);
    const reaction = s.createPanel(G, { name: 'React', mode: 'reaction' });
    assert.throws(() => s.addOption(reaction, { roleId: R1, label: 'x' }), RoleServiceError); // reactions need an emoji
    s.setPublished(panel.id, '444444444444444444', '555555555555555555');
    assert.strictEqual(s.findPanelByMessage('555555555555555555').name, 'Games');
    s.addAutoRole(G, R1); s.addTempRole({ guildId: G, userId: U, roleId: R1, expiresAt: 1000, addedBy: U });
    s.removeRoleEverywhere(G, R1);
    assert.strictEqual(s.options(panel.id).length, 0);
    assert.strictEqual(s.listAutoRoles(G).length, 0);
    assert.strictEqual(s.listTempRoles(G).length, 0);
    s.deletePanel(panel.id);
    assert.strictEqual(s.getPanel(G, 'Games'), null);
});
test('role service: panel limit and per-server isolation', () => {
    const s = createRoleService(fresh());
    for (let i = 0; i < s.MAX_PANELS; i++) s.createPanel(G, { name: `p${i}`, mode: 'button' });
    assert.throws(() => s.createPanel(G, { name: 'extra', mode: 'button' }), RoleServiceError);
    assert.doesNotThrow(() => s.createPanel('999999999999999999', { name: 'p0', mode: 'button' }));
    assert.throws(() => s.createPanel('abc', { name: 'x', mode: 'button' }), TypeError);
});
test('role service: temporary roles come due in order and can be extended', () => {
    const s = createRoleService(fresh());
    s.addTempRole({ guildId: G, userId: U, roleId: R1, expiresAt: 500, addedBy: U });
    s.addTempRole({ guildId: G, userId: U, roleId: R2, expiresAt: 5000, addedBy: U });
    assert.deepStrictEqual(s.dueTempRoles(1000).map((t) => t.roleId), [R1]);
    s.addTempRole({ guildId: G, userId: U, roleId: R1, expiresAt: 9000, addedBy: U }); // extend
    assert.strictEqual(s.dueTempRoles(1000).length, 0);
    assert.ok(s.clearTempRole(G, U, R1));
    assert.ok(!s.clearTempRole(G, U, R1));
});
test('role service: at most 10 automatic roles', () => {
    const s = createRoleService(fresh());
    for (let i = 0; i < 10; i++) s.addAutoRole(G, `33333333333333333${i}`);
    assert.throws(() => s.addAutoRole(G, '444444444444444440'), RoleServiceError);
    assert.doesNotThrow(() => s.addAutoRole(G, '333333333333333330', { target: 'all' })); // updating is fine
});

// ---------- welcome ----------
test('placeholders are replaced, unknown ones stay, new lines work', () => {
    const vars = { userid: U, username: 'sam', displayname: 'Sam', server: 'Cool', count: 1234, createdUnix: 100, joinedUnix: 200, rulesChannelId: '777777777777777777' };
    assert.strictEqual(renderTemplate('Hi {user} and {USERNAME} to {server} #{ordinal} {nope}', vars), `Hi <@${U}> and sam to Cool #1,234th {nope}`);
    assert.strictEqual(renderTemplate('a\\nb {rules} {created} {joined}', vars), 'a\nb <#777777777777777777> <t:100:R> <t:200:R>');
    assert.strictEqual(renderTemplate('{rules}', {}), '#rules');
    assert.strictEqual(renderTemplate(null, vars), '');
});
test('ordinals and colours', () => {
    assert.deepStrictEqual([1, 2, 3, 4, 11, 12, 13, 21, 101, 112].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '101st', '112th']);
    assert.strictEqual(parseColor('#FF8800'), 0xff8800);
    assert.strictEqual(parseColor('ff8800'), 0xff8800);
    assert.strictEqual(parseColor('green'), 0x2ecc71);
    assert.strictEqual(parseColor('nope'), null);
    assert.strictEqual(parseColor('#12345'), null);
});
test('welcome service: defaults, validation, reset keeps the other side', () => {
    const s = createWelcomeService(fresh());
    const w = s.get(G, 'welcome');
    assert.strictEqual(w.enabled, false); assert.strictEqual(w.style, 'embed'); assert.strictEqual(w.ping, true);
    s.set(G, 'welcome', { enabled: true, channelId: '444444444444444444', message: 'Hi {user}', style: 'card', footer: 'x', bannerUrl: 'https://a.b/c.png' });
    s.set(G, 'goodbye', { enabled: true, message: 'Bye' });
    assert.strictEqual(s.get(G, 'welcome').style, 'card');
    assert.throws(() => s.set(G, 'welcome', { style: 'weird' }), TypeError);
    assert.throws(() => s.set(G, 'welcome', { message: '' }), TypeError);
    assert.throws(() => s.set(G, 'welcome', { message: 'x'.repeat(1801) }), TypeError);
    assert.throws(() => s.set(G, 'welcome', { bannerUrl: 'http://insecure' }), TypeError);
    assert.throws(() => s.set(G, 'welcome', { deleteAfter: -1 }), TypeError);
    assert.throws(() => s.set(G, 'welcome', { channelId: 'abc' }), TypeError);
    assert.throws(() => s.set(G, 'welcome', { nonsense: 1 }), TypeError);
    assert.strictEqual(s.get(G, 'welcome').message, 'Hi {user}'); // a failed change changed nothing
    s.set(G, 'welcome', { footer: null, bannerUrl: null });
    assert.strictEqual(s.get(G, 'welcome').footer, null);
    s.reset(G, 'welcome');
    assert.strictEqual(s.get(G, 'welcome').enabled, false);
    assert.strictEqual(s.get(G, 'welcome').message.includes('welcome to'), true);
    assert.strictEqual(s.get(G, 'goodbye').enabled, true); assert.strictEqual(s.get(G, 'goodbye').message, 'Bye');
    assert.strictEqual(s.get('999999999999999999', 'welcome').enabled, false); // other servers unaffected
});

// ---------- channels ----------
test('channel names are cleaned', () => {
    assert.strictEqual(rules.slugifyChannelName('  General Chat!! '), 'general-chat');
    assert.strictEqual(rules.slugifyChannelName('a__b   c'), 'a-b-c');
    assert.strictEqual(rules.slugifyChannelName('!!!'), '');
    assert.strictEqual(rules.cleanDisplayName('  Fun   @everyone #1 '), 'Fun everyone 1');
    assert.strictEqual(rules.slugifyChannelName('x'.repeat(300)).length, 100);
});
test('room names use the template', () => {
    assert.strictEqual(rules.renderRoomName("{displayname}'s room", { displayname: 'Sam' }), "Sam's room");
    assert.strictEqual(rules.renderRoomName('Room {number} {username}', { username: 'sam', number: 3 }), 'Room 3 sam');
    assert.strictEqual(rules.renderRoomName('@@', {}), 'Voice room');
});
test('template specs: saved without permissions and validated before use', () => {
    const spec = rules.buildTemplateSpec({ name: 'Games' }, [{ name: 'chat', type: 'text', topic: 't', nsfw: false, slowmode: 5 }, { name: 'Lobby', type: 'voice', userLimit: 4 }]);
    assert.strictEqual(JSON.stringify(spec).includes('permission'), false);
    assert.strictEqual(rules.validateTemplateSpec(spec), null);
    assert.ok(rules.validateTemplateSpec(null));
    assert.ok(rules.validateTemplateSpec({ category: 'x', channels: [] }));
    assert.ok(rules.validateTemplateSpec({ category: 'x', channels: [{ name: 'a', type: 'evil' }] }));
    assert.ok(rules.validateTemplateSpec({ category: 'x', channels: Array.from({ length: 51 }, () => ({ name: 'a', type: 'text' })) }));
});
test('room control: owner or channel managers', () => {
    const room = { ownerId: U };
    assert.ok(rules.canControlRoom({ room, userId: U, hasManageChannels: false }));
    assert.ok(rules.canControlRoom({ room, userId: 'x', hasManageChannels: true }));
    assert.ok(!rules.canControlRoom({ room, userId: 'x', hasManageChannels: false }));
    assert.ok(!rules.canControlRoom({ room: null, userId: U, hasManageChannels: true }));
});
test('channel service: templates and temporary rooms', () => {
    const s = createChannelService(fresh());
    s.saveTemplate(G, 'Games', { category: 'G', channels: [{ name: 'a', type: 'text' }] }, U);
    s.saveTemplate(G, 'games', { category: 'G2', channels: [{ name: 'a', type: 'text' }] }, U); // same name: replaced
    assert.strictEqual(s.listTemplates(G).length, 1);
    assert.strictEqual(s.getTemplate(G, 'GAMES').spec.category, 'G2');
    assert.ok(s.deleteTemplate(G, 'games')); assert.ok(!s.deleteTemplate(G, 'games'));
    for (let i = 0; i < s.MAX_TEMPLATES; i++) s.saveTemplate(G, `t${i}`, { category: 'x', channels: [] }, U);
    assert.throws(() => s.saveTemplate(G, 'overflow', {}, U), ChannelServiceError);

    assert.strictEqual(s.getVoiceConfig(G).enabled, false);
    s.setVoiceConfig(G, { enabled: true, triggerChannelId: '444444444444444444', defaultLimit: 5 });
    assert.strictEqual(s.getVoiceConfig(G).defaultLimit, 5);
    assert.throws(() => s.setVoiceConfig(G, { defaultLimit: 100 }), TypeError);
    assert.throws(() => s.setVoiceConfig(G, { triggerChannelId: 'x' }), TypeError);
    s.addRoom(G, '555555555555555555', U);
    assert.strictEqual(s.getRoom('555555555555555555').ownerId, U);
    s.setRoomOwner('555555555555555555', 'x'); assert.strictEqual(s.getRoom('555555555555555555').ownerId, 'x');
    assert.strictEqual(s.countRooms(G), 1);
    s.removeRoom('555555555555555555'); assert.strictEqual(s.getRoom('555555555555555555'), null);
});

// ---------- quotes ----------
test('quote service: switches and cooldown', () => {
    let t = 1000;
    const s = createQuoteService(fresh(), { now: () => t, cooldownMs: 6000 });
    assert.deepStrictEqual(s.getConfig(G), { enabled: true, replyTrigger: true });
    s.setReplyTrigger(G, false); s.setEnabled(G, false);
    assert.deepStrictEqual(s.getConfig(G), { enabled: false, replyTrigger: false });
    assert.strictEqual(s.checkCooldown(G, U), 0);
    t += 2000; assert.strictEqual(s.checkCooldown(G, U), 4000);
    assert.strictEqual(s.checkCooldown(G, 'other'), 0); // other people are not affected
    assert.strictEqual(s.checkCooldown('999999999999999999', U), 0); // other servers either
    t += 6000; assert.strictEqual(s.checkCooldown(G, U), 0);
});
test('quote text: cleaning hides spoilers, links and junk', () => {
    assert.strictEqual(cleanQuoteText('hi ||secret|| <:cat:123456789012345678> `code` ~~x~~'), 'hi [spoiler] :cat: code x');
    assert.strictEqual(cleanQuoteText('<@123>'), '<@123>'); // Discord's cleanContent resolves mentions before this
    assert.strictEqual(cleanQuoteText('   '), '');
    assert.strictEqual(cleanQuoteText(null), '');
    assert.ok(cleanQuoteText('x'.repeat(2000)).length <= 500);
    assert.ok(cleanQuoteText('https://example.com/' + 'a'.repeat(100)).length < 45);
    assert.strictEqual(cleanQuoteText('a‮b​c'), 'abc');
});
test('quote text: bold and italic pieces', () => {
    assert.deepStrictEqual(parseInline('a **b** *c*'), [{ text: 'a ', bold: false, italic: false }, { text: 'b', bold: true, italic: false }, { text: ' ', bold: false, italic: false }, { text: 'c', bold: false, italic: true }]);
    assert.strictEqual(parseInline('2 * 3 = 6').map((p) => p.text).join(''), '2 * 3 = 6'); // lone star stays
});
