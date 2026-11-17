const { isSnowflake } = require('../utils/snowflake');
const R = require('../custom/rules');

class CustomServiceError extends Error {} // safe to show to a moderator

function createCustomService(db, { now = Date.now } = {}) {
    const ensure = (guildId) => { if (!isSnowflake(guildId)) throw new TypeError('Invalid server ID.'); db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId); };
    const toTag = (r) => (r ? { name: r.name, response: r.response, createdBy: r.created_by, uses: r.uses, createdAt: r.created_at, updatedAt: r.updated_at } : null);
    const toResp = (r) => ({ id: r.id, trigger: r.trigger_text, matchType: r.match_type, response: r.response, cooldownSeconds: r.cooldown_seconds, channelId: r.channel_id, enabled: r.enabled === 1, uses: r.uses, createdBy: r.created_by });
    const cache = new Map(); // guildId -> enabled responders (so every chat message does not hit the database)
    const last = new Map(); // "guildId:id" -> time of the last answer (cooldown)
    const load = (guildId) => { let l = cache.get(guildId); if (!l) { l = db.prepare('SELECT * FROM autoresponders WHERE guild_id = ? AND enabled = 1 ORDER BY id').all(guildId).map(toResp); if (cache.size > 2000) cache.clear(); cache.set(guildId, l); } return l; };
    const dirty = (guildId) => cache.delete(guildId);
    const goodName = (name) => { const n = String(name ?? '').trim().toLowerCase(); if (!R.NAME_RULE.test(n)) throw new CustomServiceError('A name can use letters a-z, numbers, - and _ (1 to 32 characters), with no spaces.'); return n; };
    const goodResponse = (text) => { const t = R.cleanBody(text); if (!t) throw new CustomServiceError(`The reply must be 1 to ${R.MAX_RESPONSE} characters.`); return t; };

    return {
        tags: {
            create(guildId, name, response, userId) {
                ensure(guildId); const n = goodName(name); const text = goodResponse(response);
                if (db.prepare('SELECT 1 FROM custom_commands WHERE guild_id = ? AND name = ?').get(guildId, n)) throw new CustomServiceError(`A command named **${n}** already exists. Use \`/tag edit\`.`);
                if (db.prepare('SELECT COUNT(*) AS n FROM custom_commands WHERE guild_id = ?').get(guildId).n >= R.MAX_TAGS) throw new CustomServiceError(`You can have at most ${R.MAX_TAGS} custom commands.`);
                const t = now(); db.prepare('INSERT INTO custom_commands (guild_id, name, response, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(guildId, n, text, userId, t, t); return n;
            },
            edit(guildId, name, response) {
                const n = goodName(name); const text = goodResponse(response);
                if (!Number(db.prepare('UPDATE custom_commands SET response = ?, updated_at = ? WHERE guild_id = ? AND name = ?').run(text, now(), guildId, n).changes)) throw new CustomServiceError(`There is no custom command named **${n}**.`);
                return n;
            },
            remove: (guildId, name) => Number(db.prepare('DELETE FROM custom_commands WHERE guild_id = ? AND name = ?').run(guildId, String(name ?? '').trim().toLowerCase()).changes) > 0,
            get: (guildId, name) => toTag(db.prepare('SELECT * FROM custom_commands WHERE guild_id = ? AND name = ?').get(guildId, String(name ?? '').trim().toLowerCase())),
            use(guildId, name) { db.prepare('UPDATE custom_commands SET uses = uses + 1 WHERE guild_id = ? AND name = ?').run(guildId, name); },
            list: (guildId) => db.prepare('SELECT * FROM custom_commands WHERE guild_id = ? ORDER BY name').all(guildId).map(toTag),
            count: (guildId) => db.prepare('SELECT COUNT(*) AS n FROM custom_commands WHERE guild_id = ?').get(guildId).n,
        },
        responders: {
            add(guildId, { trigger, response, matchType = 'contains', cooldownSeconds = R.DEFAULT_COOLDOWN, channelId = null, createdBy }) {
                ensure(guildId); const trig = R.normalize(trigger);
                if (trig.length < R.MIN_TRIGGER || trig.length > R.MAX_TRIGGER) throw new CustomServiceError(`The trigger must be ${R.MIN_TRIGGER} to ${R.MAX_TRIGGER} characters.`);
                if (!R.MATCH_TYPES.includes(matchType)) throw new CustomServiceError('Unknown match type.');
                if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > R.MAX_COOLDOWN) throw new CustomServiceError(`The cooldown must be 0 to ${R.MAX_COOLDOWN} seconds.`);
                if (channelId !== null && !isSnowflake(channelId)) throw new TypeError('Invalid channel ID.');
                const text = goodResponse(response);
                if (db.prepare('SELECT COUNT(*) AS n FROM autoresponders WHERE guild_id = ?').get(guildId).n >= R.MAX_RESPONDERS) throw new CustomServiceError(`You can have at most ${R.MAX_RESPONDERS} auto-responders.`);
                const id = Number(db.prepare('INSERT INTO autoresponders (guild_id, trigger_text, match_type, response, cooldown_seconds, channel_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(guildId, trig, matchType, text, cooldownSeconds, channelId, createdBy, now()).lastInsertRowid);
                dirty(guildId); return id;
            },
            remove(guildId, id) { const ok = Number(db.prepare('DELETE FROM autoresponders WHERE guild_id = ? AND id = ?').run(guildId, id).changes) > 0; dirty(guildId); return ok; },
            setEnabled(guildId, id, enabled) { const ok = Number(db.prepare('UPDATE autoresponders SET enabled = ? WHERE guild_id = ? AND id = ?').run(enabled ? 1 : 0, guildId, id).changes) > 0; dirty(guildId); return ok; },
            list: (guildId) => db.prepare('SELECT * FROM autoresponders WHERE guild_id = ? ORDER BY id').all(guildId).map(toResp),
            // Which responder answers this message? (first match wins). Does NOT use the cooldown.
            findMatch(guildId, content, channelId) { return load(guildId).find((r) => (!r.channelId || r.channelId === channelId) && R.matches(r.matchType, r.trigger, content)) ?? null; },
            // true = go ahead and answer now (and the cooldown starts); false = still cooling down.
            claim(guildId, responder) {
                const key = `${guildId}:${responder.id}`; const t = now();
                if (t - (last.get(key) ?? -Infinity) < responder.cooldownSeconds * 1000) return false;
                if (last.size > 5000) for (const [k, v] of last) if (t - v > 3600000) last.delete(k);
                last.set(key, t); db.prepare('UPDATE autoresponders SET uses = uses + 1 WHERE id = ?').run(responder.id); return true;
            },
        },
    };
}

module.exports = { createCustomService, CustomServiceError };
