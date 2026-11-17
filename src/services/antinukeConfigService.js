const { isSnowflake } = require('../utils/snowflake');
const { RULE_NAMES } = require('../antinuke/rules');

const MODES = ['alert', 'contain'];
const SENSITIVITIES = ['relaxed', 'balanced', 'strict'];
const MAX_SAFE_MODE_MINUTES = 24 * 60;

// Stores each server's anti-nuke settings. Off by default.
function createAntinukeConfigService(db, { now = Date.now } = {}) {
    const insertGuild = db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)');
    const insertConfig = db.prepare('INSERT OR IGNORE INTO antinuke_config (guild_id) VALUES (?)');
    const selectConfig = db.prepare('SELECT * FROM antinuke_config WHERE guild_id = ?');
    const selectThresholds = db.prepare('SELECT rule, threshold, window_seconds FROM antinuke_thresholds WHERE guild_id = ?');
    const upsertThreshold = db.prepare(`
        INSERT INTO antinuke_thresholds (guild_id, rule, threshold, window_seconds) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id, rule) DO UPDATE SET threshold = excluded.threshold, window_seconds = excluded.window_seconds
    `);
    const deleteThreshold = db.prepare('DELETE FROM antinuke_thresholds WHERE guild_id = ? AND rule = ?');
    const insertTrusted = db.prepare('INSERT OR IGNORE INTO antinuke_trusted (guild_id, kind, target_id) VALUES (?, ?, ?)');
    const deleteTrusted = db.prepare('DELETE FROM antinuke_trusted WHERE guild_id = ? AND kind = ? AND target_id = ?');
    const selectTrusted = db.prepare('SELECT kind, target_id FROM antinuke_trusted WHERE guild_id = ?');

    function ensure(guildId) {
        if (!isSnowflake(guildId)) throw new TypeError('Invalid guild ID.');
        insertGuild.run(guildId);
        insertConfig.run(guildId);
    }

    // Changes one column. `column` always comes from the fixed list in this file, never from users.
    function update(guildId, column, value) {
        ensure(guildId);
        db.prepare(`UPDATE antinuke_config SET ${column} = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE guild_id = ?`)
            .run(value, guildId);
    }

    const setEnabled = (guildId, enabled) => update(guildId, 'enabled', enabled ? 1 : 0);

    function setMode(guildId, mode) {
        if (!MODES.includes(mode)) throw new TypeError('Invalid mode.');
        update(guildId, 'mode', mode);
    }

    function setSensitivity(guildId, sensitivity) {
        if (!SENSITIVITIES.includes(sensitivity)) throw new TypeError('Invalid sensitivity.');
        update(guildId, 'sensitivity', sensitivity);
    }

    function setAlertChannel(guildId, channelId) {
        if (channelId !== null && !isSnowflake(channelId)) throw new TypeError('Invalid channel ID.');
        update(guildId, 'alert_channel_id', channelId);
    }

    // The role that gets pinged on an alert. Optional: null = ping nobody.
    function setAlertRole(guildId, roleId) {
        if (roleId !== null && !isSnowflake(roleId)) throw new TypeError('Invalid role ID.');
        update(guildId, 'alert_role_id', roleId);
    }

    // minutes = 0 (or null) turns safe mode off.
    function setSafeMode(guildId, minutes) {
        if (!minutes) return update(guildId, 'safe_mode_until', null);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_SAFE_MODE_MINUTES) {
            throw new TypeError('Safe mode must last between 1 minute and 24 hours.');
        }
        return update(guildId, 'safe_mode_until', new Date(now() + minutes * 60000).toISOString());
    }

    function setThreshold(guildId, rule, threshold, windowSec) {
        if (!RULE_NAMES.includes(rule)) throw new TypeError('Unknown rule.');
        if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) throw new TypeError('Count must be 1-100.');
        if (!Number.isInteger(windowSec) || windowSec < 5 || windowSec > 300) throw new TypeError('Seconds must be 5-300.');
        ensure(guildId);
        upsertThreshold.run(guildId, rule, threshold, windowSec);
    }

    function clearThreshold(guildId, rule) {
        if (!RULE_NAMES.includes(rule)) throw new TypeError('Unknown rule.');
        return deleteThreshold.run(guildId, rule).changes > 0;
    }

    function addTrusted(guildId, kind, targetId) {
        if (!['user', 'role'].includes(kind) || !isSnowflake(targetId)) throw new TypeError('Invalid trusted entry.');
        ensure(guildId);
        return insertTrusted.run(guildId, kind, targetId).changes > 0;
    }

    function removeTrusted(guildId, kind, targetId) {
        return deleteTrusted.run(guildId, kind, targetId).changes > 0;
    }

    function listTrusted(guildId) {
        const rows = selectTrusted.all(guildId);
        return {
            userIds: rows.filter((r) => r.kind === 'user').map((r) => r.target_id),
            roleIds: rows.filter((r) => r.kind === 'role').map((r) => r.target_id),
        };
    }

    // Everything the detector needs, with safe mode already applied.
    function getEffective(guildId) {
        ensure(guildId);
        const row = selectConfig.get(guildId);
        const safe = Boolean(row.safe_mode_until) && Date.parse(row.safe_mode_until) > now();
        const overrides = {};
        for (const t of selectThresholds.all(guildId)) {
            overrides[t.rule] = { threshold: t.threshold, windowSec: t.window_seconds };
        }
        const trusted = listTrusted(guildId);
        return {
            guildId,
            enabled: row.enabled === 1,
            configuredMode: row.mode,
            mode: safe ? 'contain' : row.mode, // safe mode forces containment
            sensitivity: row.sensitivity,
            alertChannelId: row.alert_channel_id,
            alertRoleId: row.alert_role_id ?? null,
            safe,
            safeModeUntil: safe ? row.safe_mode_until : null,
            overrides,
            trustedUserIds: trusted.userIds,
            trustedRoleIds: trusted.roleIds,
        };
    }

    return {
        setEnabled, setMode, setSensitivity, setAlertChannel, setAlertRole, setSafeMode,
        setThreshold, clearThreshold, addTrusted, removeTrusted, listTrusted, getEffective,
    };
}

module.exports = { createAntinukeConfigService, MODES, SENSITIVITIES };
