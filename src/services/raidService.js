const { isSnowflake } = require('../utils/snowflake');
const { LIMITS, ACTIONS, checkSetting } = require('../raid/rules');

class RaidServiceError extends Error {} // safe to show

function createRaidService(db, { now = Date.now } = {}) {
    const ensure = (g) => { if (!isSnowflake(g)) throw new TypeError('Invalid server ID.'); db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(g); };
    const toEvent = (r) => (r ? { id: r.id, guildId: r.guild_id, startedAt: r.started_at, lastJoinAt: r.last_join_at, endedAt: r.ended_at, endedBy: r.ended_by, auto: Boolean(r.auto), raiders: r.raiders, prevVerification: r.prev_verification, setVerification: r.set_verification, invitesPaused: Boolean(r.invites_paused), alertMessageId: r.alert_message_id, alertChannelId: r.alert_channel_id } : null);
    const toConfig = (r) => ({ enabled: Boolean(r?.enabled), joins: r?.joins ?? 10, seconds: r?.seconds ?? 30, action: r?.action ?? 'alert', durationMinutes: r?.duration_minutes ?? 15, alertChannelId: r?.alert_channel_id ?? null, alertRoleId: r?.alert_role_id ?? null, raiseVerification: r ? Boolean(r.raise_verification) : true, pauseInvites: r ? Boolean(r.pause_invites) : true });
    let enabledCache = null; // join events happen all the time: remember which servers have raid mode on
    const enabledSet = () => (enabledCache ??= new Set(db.prepare('SELECT guild_id FROM raid_config WHERE enabled = 1').all().map((r) => r.guild_id)));

    return {
        getConfig: (g) => toConfig(db.prepare('SELECT * FROM raid_config WHERE guild_id = ?').get(g)),
        isEnabled: (g) => enabledSet().has(g),
        // patch: any of joins, seconds, action, durationMinutes, alertChannelId, alertRoleId, raiseVerification, pauseInvites, enabled
        configure(g, patch) {
            ensure(g);
            if (patch.joins !== undefined && !checkSetting('joins', patch.joins)) throw new RaidServiceError(`joins must be ${LIMITS.joins[0]} to ${LIMITS.joins[1]}.`);
            if (patch.seconds !== undefined && !checkSetting('seconds', patch.seconds)) throw new RaidServiceError(`seconds must be ${LIMITS.seconds[0]} to ${LIMITS.seconds[1]}.`);
            if (patch.durationMinutes !== undefined && !checkSetting('duration_minutes', patch.durationMinutes)) throw new RaidServiceError(`duration must be ${LIMITS.duration_minutes[0]} to ${LIMITS.duration_minutes[1]} minutes.`);
            if (patch.action !== undefined && !ACTIONS.includes(patch.action)) throw new RaidServiceError('Unknown action.');
            for (const k of ['alertChannelId', 'alertRoleId']) if (patch[k] != null && !isSnowflake(patch[k])) throw new TypeError('Invalid ID.');
            const c = this.getConfig(g); const m = { ...c, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
            db.prepare(`INSERT INTO raid_config (guild_id, enabled, joins, seconds, action, duration_minutes, alert_channel_id, alert_role_id, raise_verification, pause_invites) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (guild_id) DO UPDATE SET enabled = excluded.enabled, joins = excluded.joins, seconds = excluded.seconds, action = excluded.action, duration_minutes = excluded.duration_minutes, alert_channel_id = excluded.alert_channel_id, alert_role_id = excluded.alert_role_id, raise_verification = excluded.raise_verification, pause_invites = excluded.pause_invites`)
                .run(g, m.enabled ? 1 : 0, m.joins, m.seconds, m.action, m.durationMinutes, m.alertChannelId, m.alertRoleId, m.raiseVerification ? 1 : 0, m.pauseInvites ? 1 : 0);
            if (m.enabled) enabledSet().add(g); else enabledSet().delete(g);
            return this.getConfig(g);
        },
        // Exactly one active raid per server: a second start returns null.
        start(g, { auto = true, raiders = 0, prevVerification = null, setVerification = null, invitesPaused = false } = {}) {
            ensure(g); const t = now();
            try { return Number(db.prepare('INSERT INTO raid_events (guild_id, started_at, last_join_at, auto, raiders, prev_verification, set_verification, invites_paused) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(g, t, t, auto ? 1 : 0, raiders, prevVerification, setVerification, invitesPaused ? 1 : 0).lastInsertRowid); }
            catch (error) { if (/UNIQUE/i.test(error.message)) return null; throw error; }
        },
        active: (g) => toEvent(db.prepare('SELECT * FROM raid_events WHERE guild_id = ? AND ended_at IS NULL').get(g)),
        activeEvents: () => db.prepare('SELECT * FROM raid_events WHERE ended_at IS NULL').all().map(toEvent),
        get: (id) => toEvent(db.prepare('SELECT * FROM raid_events WHERE id = ?').get(id)),
        addRaider(id, n = 1) { db.prepare('UPDATE raid_events SET raiders = raiders + ?, last_join_at = ? WHERE id = ? AND ended_at IS NULL').run(n, now(), id); },
        setAlert(id, channelId, messageId) { db.prepare('UPDATE raid_events SET alert_channel_id = ?, alert_message_id = ? WHERE id = ?').run(channelId, messageId, id); },
        // Exactly once: only the first call returns the event (so the settings are restored only once).
        end(id, by) {
            const changed = Number(db.prepare('UPDATE raid_events SET ended_at = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL').run(now(), String(by).slice(0, 40), id).changes) > 0;
            return changed ? toEvent(db.prepare('SELECT * FROM raid_events WHERE id = ?').get(id)) : null;
        },
        history: (g, limit = 5) => db.prepare('SELECT * FROM raid_events WHERE guild_id = ? AND ended_at IS NOT NULL ORDER BY id DESC LIMIT ?').all(g, limit).map(toEvent),
    };
}
module.exports = { createRaidService, RaidServiceError };
