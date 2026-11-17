const { isSnowflake } = require('../utils/snowflake');
const R = require('../moderation/escalation');

class EscalationServiceError extends Error {} // safe to show to a moderator

function createEscalationService(db) {
    const ensure = (g) => { if (!isSnowflake(g)) throw new TypeError('Invalid server ID.'); db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(g); };
    const toRule = (r) => ({ threshold: r.threshold, action: r.action, durationMinutes: r.duration_minutes });
    const cfg = (g) => { const r = db.prepare('SELECT * FROM warn_escalation_config WHERE guild_id = ?').get(g); return { enabled: Boolean(r?.enabled), windowDays: r?.window_days ?? 0 }; };
    const save = (g, enabled, windowDays) => { ensure(g); db.prepare('INSERT INTO warn_escalation_config (guild_id, enabled, window_days) VALUES (?, ?, ?) ON CONFLICT (guild_id) DO UPDATE SET enabled = excluded.enabled, window_days = excluded.window_days').run(g, enabled ? 1 : 0, windowDays); };
    return {
        getConfig: cfg,
        setEnabled(g, on) { save(g, on, cfg(g).windowDays); },
        setWindow(g, days) { if (!Number.isInteger(days) || days < 0 || days > R.MAX_WINDOW_DAYS) throw new EscalationServiceError(`The number of days must be 0 to ${R.MAX_WINDOW_DAYS} (0 = count every active warning).`); save(g, cfg(g).enabled, days); },
        list: (g) => db.prepare('SELECT * FROM warn_escalation_rules WHERE guild_id = ? ORDER BY threshold').all(g).map(toRule),
        setRule(g, input) {
            const v = R.validateRule(input); if (v.problem) throw new EscalationServiceError(v.problem); ensure(g);
            const exists = db.prepare('SELECT 1 FROM warn_escalation_rules WHERE guild_id = ? AND threshold = ?').get(g, v.rule.threshold);
            if (!exists && db.prepare('SELECT COUNT(*) AS n FROM warn_escalation_rules WHERE guild_id = ?').get(g).n >= R.MAX_RULES) throw new EscalationServiceError(`You can have up to ${R.MAX_RULES} rules.`);
            db.prepare('INSERT INTO warn_escalation_rules (guild_id, threshold, action, duration_minutes) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, threshold) DO UPDATE SET action = excluded.action, duration_minutes = excluded.duration_minutes').run(g, v.rule.threshold, v.rule.action, v.rule.durationMinutes);
            return v.rule;
        },
        removeRule: (g, threshold) => Number(db.prepare('DELETE FROM warn_escalation_rules WHERE guild_id = ? AND threshold = ?').run(g, threshold).changes) > 0,
    };
}
module.exports = { createEscalationService, EscalationServiceError };
