// Does the work of a restore. It only ever ADDS things (and, if asked, fixes permissions): it never deletes anything.
const logger = require('../utils/logger');

const TEXTLIKE = new Set([0, 5, 15]), VOICELIKE = new Set([2, 13]);
const big = (v) => { try { return BigInt(v ?? 0); } catch { return 0n; } };

// plan: from planRestore(); current state is read from the guild so names created a moment ago are found
async function runRestore(guild, snap, plan, { botTop = 0, reason = 'Server restore' } = {}) {
    const r = { rolesCreated: 0, channelsCreated: 0, rolesFixed: 0, channelsFixed: 0, settings: false, failed: [] };
    const fail = (what, e) => { if (r.failed.length < 15) r.failed.push(`${what}: ${String(e?.message ?? e).slice(0, 100)}`); logger.warn(`Restore step failed in ${guild.id}: ${what}: ${e?.message}`); };
    const roleId = new Map(); // snapshot role key -> real role id
    const byName = (name) => [...guild.roles.cache.values()].find((x) => x.name === name && x.id !== guild.id);
    for (const sr of snap.roles) { const ex = byName(sr.name); if (ex) roleId.set(sr.key, ex.id); }

    for (const sr of plan.rolesToCreate) {
        try {
            const opts = { name: sr.name, color: sr.color, hoist: sr.hoist, mentionable: sr.mentionable, permissions: big(sr.permissions), reason };
            if (botTop > 1) opts.position = Math.max(1, Math.min(sr.position, botTop - 1));
            const created = await guild.roles.create(opts); roleId.set(sr.key, created.id); r.rolesCreated++;
        } catch (e) { fail(`role "${sr.name}"`, e); }
    }
    for (const sr of plan.rolesToFix) {
        try { const role = byName(sr.name); if (role && role.editable !== false) { await role.edit({ color: sr.color, hoist: sr.hoist, mentionable: sr.mentionable, permissions: big(sr.permissions), reason }); r.rolesFixed++; } } catch (e) { fail(`fix role "${sr.name}"`, e); }
    }
    const everyone = guild.roles.cache.get(guild.id);
    if (plan.rolesToFix.length && everyone && snap.everyonePermissions != null) { try { await everyone.setPermissions(big(snap.everyonePermissions), reason); } catch (e) { fail('@everyone permissions', e); } }

    const overwritesFor = (c) => c.overwrites.map((o) => {
        const id = o.kind === 'everyone' ? guild.id : o.kind === 'role' ? roleId.get(o.key) : (guild.members?.cache?.has?.(o.id) ? o.id : null);
        return id ? { id, type: o.kind === 'member' ? 1 : 0, allow: big(o.allow), deny: big(o.deny) } : null;
    }).filter(Boolean);
    const catId = new Map(); for (const c of guild.channels.cache.values()) if (c.type === 4) catId.set(c.name, c.id);
    const findExisting = (c) => [...guild.channels.cache.values()].find((x) => x.name === c.name && x.type === c.type && (c.type === 4 || (x.parent?.name ?? null) === (c.parent ?? null)));

    const order = [...plan.channelsToCreate].sort((a, b) => (a.type === 4 ? 0 : 1) - (b.type === 4 ? 0 : 1) || a.position - b.position);
    for (const c of order) {
        try {
            const o = { name: c.name, type: c.type, permissionOverwrites: overwritesFor(c), reason };
            if (TEXTLIKE.has(c.type)) { if (c.topic) o.topic = c.topic; o.nsfw = c.nsfw; if (c.type !== 15 && c.slowmode) o.rateLimitPerUser = c.slowmode; }
            if (VOICELIKE.has(c.type) && c.userLimit) o.userLimit = c.userLimit;
            if (c.type !== 4 && c.parent && catId.has(c.parent)) o.parent = catId.get(c.parent);
            const created = await guild.channels.create(o); if (c.type === 4) catId.set(c.name, created.id); r.channelsCreated++;
        } catch (e) { fail(`channel "${c.name}"`, e); }
    }
    for (const c of plan.channelsToFix) {
        try { const ch = findExisting(c); if (ch?.permissionOverwrites?.set) { await ch.permissionOverwrites.set(overwritesFor(c), reason); r.channelsFixed++; } } catch (e) { fail(`fix channel "${c.name}"`, e); }
    }
    if (plan.settings) {
        try {
            const g = snap.guild; const edit = { reason };
            for (const k of ['name', 'verificationLevel', 'defaultMessageNotifications', 'explicitContentFilter', 'afkTimeout']) if (g[k] != null) edit[k] = g[k];
            const pick = (name, kinds) => name && [...guild.channels.cache.values()].find((x) => x.name === name && kinds.has(x.type))?.id;
            const afk = pick(g.afkChannel, VOICELIKE), sys = pick(g.systemChannel, TEXTLIKE); if (afk) edit.afkChannel = afk; if (sys) edit.systemChannel = sys;
            await guild.edit(edit); r.settings = true;
        } catch (e) { fail('server settings', e); }
    }
    return r;
}
module.exports = { runRestore };
