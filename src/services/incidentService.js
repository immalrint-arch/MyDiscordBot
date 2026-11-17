const { isSnowflake } = require('../utils/snowflake');

const MAX_EVIDENCE = 25;
const RETENTION_DAYS = 14;

function parseJson(text, fallback) {
    try { return JSON.parse(text); } catch { return fallback; }
}

function toIncident(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        number: row.incident_number,
        actorId: row.actor_id,
        actorClass: row.actor_class,
        severity: row.severity,
        status: row.status,
        rules: parseJson(row.rules, []),
        evidence: parseJson(row.evidence, []),
        removedRoles: parseJson(row.removed_roles, []),
        simulated: row.simulated === 1,
        alertChannelId: row.alert_channel_id,
        alertMessageId: row.alert_message_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// Stores incidents (suspicious situations) and the structure of deleted channels/roles.
function createIncidentService(db, { now = Date.now } = {}) {
    const insertGuild = db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)');
    const insertIncident = db.prepare(`
        INSERT INTO antinuke_incidents (guild_id, incident_number, actor_id, actor_class, severity, rules, evidence, simulated)
        VALUES (?, (SELECT COALESCE(MAX(incident_number), 0) + 1 FROM antinuke_incidents WHERE guild_id = ?), ?, ?, ?, ?, ?, ?)
        RETURNING *
    `);
    const selectByNumber = db.prepare('SELECT * FROM antinuke_incidents WHERE guild_id = ? AND incident_number = ?');
    const selectRecentOpenForActor = db.prepare(
        "SELECT * FROM antinuke_incidents WHERE guild_id = ? AND actor_id = ? AND simulated = 0 AND status IN ('open','contained') AND created_at >= ? ORDER BY id DESC LIMIT 1"
    );
    const selectRecentOpenUnknown = db.prepare(
        "SELECT * FROM antinuke_incidents WHERE guild_id = ? AND actor_id IS NULL AND simulated = 0 AND status = 'open' AND created_at >= ? ORDER BY id DESC LIMIT 1"
    );
    const selectList = db.prepare('SELECT * FROM antinuke_incidents WHERE guild_id = ? ORDER BY incident_number DESC LIMIT ?');
    const updateIncident = db.prepare(`
        UPDATE antinuke_incidents
        SET severity = ?, status = ?, rules = ?, evidence = ?, removed_roles = ?, alert_channel_id = ?, alert_message_id = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE guild_id = ? AND incident_number = ?
    `);
    const insertItem = db.prepare(
        'INSERT INTO antinuke_deleted_items (guild_id, kind, original_id, actor_id, data) VALUES (?, ?, ?, ?, ?)'
    );
    const selectItems = db.prepare(
        'SELECT * FROM antinuke_deleted_items WHERE guild_id = ? AND (actor_id IS ? OR actor_id = ?) AND created_at >= ? AND recovered = 0 ORDER BY id'
    );
    const claimItem = db.prepare('UPDATE antinuke_deleted_items SET recovered = 1 WHERE id = ? AND recovered = 0');
    const purgeItems = db.prepare('DELETE FROM antinuke_deleted_items WHERE created_at < ?');
    const purgeIncidents = db.prepare("DELETE FROM antinuke_incidents WHERE created_at < ? AND status != 'open'");

    function createIncident({ guildId, actorId = null, actorClass, severity, rules, evidence, simulated = false }) {
        if (!isSnowflake(guildId) || (actorId !== null && !isSnowflake(actorId))) throw new TypeError('Invalid Discord ID.');
        insertGuild.run(guildId);
        return toIncident(insertIncident.get(
            guildId, guildId, actorId, actorClass, severity,
            JSON.stringify(rules), JSON.stringify(evidence.slice(-MAX_EVIDENCE)), simulated ? 1 : 0
        ));
    }

    const getIncident = (guildId, number) => toIncident(selectByNumber.get(guildId, number));
    const listIncidents = (guildId, limit = 10) => selectList.all(guildId, Math.min(Math.max(limit, 1), 25)).map(toIncident);

    // An incident for this actor that started recently and is still open or contained.
    function findRecentOpen(guildId, actorId, withinMs) {
        const since = new Date(now() - withinMs).toISOString();
        const row = actorId ? selectRecentOpenForActor.get(guildId, actorId, since) : selectRecentOpenUnknown.get(guildId, since);
        return toIncident(row);
    }

    // Saves the changed fields of an incident. `changes` can hold any of:
    // severity, status, rules, evidence, removedRoles, alertChannelId, alertMessageId
    function saveIncident(incident) {
        updateIncident.run(
            incident.severity, incident.status, JSON.stringify(incident.rules),
            JSON.stringify(incident.evidence.slice(-MAX_EVIDENCE)), JSON.stringify(incident.removedRoles),
            incident.alertChannelId ?? null, incident.alertMessageId ?? null,
            incident.guildId, incident.number
        );
        return getIncident(incident.guildId, incident.number);
    }

    function saveDeletedItem({ guildId, kind, originalId, actorId = null, data }) {
        insertGuild.run(guildId);
        insertItem.run(guildId, kind, originalId, actorId, JSON.stringify(data));
    }

    // Deleted items by one actor since a moment in time that have not been recovered yet.
    function listDeletedItems(guildId, actorId, sinceMs) {
        const since = new Date(sinceMs).toISOString();
        return selectItems.all(guildId, actorId, actorId, since).map((row) => ({
            id: row.id, kind: row.kind, originalId: row.original_id, data: parseJson(row.data, {}),
        }));
    }

    // Marks an item as recovered. Returns false if someone else already did (prevents duplicates).
    const claimDeletedItem = (id) => claimItem.run(id).changes > 0;

    function purgeOld() {
        const cutoff = new Date(now() - RETENTION_DAYS * 86400000).toISOString();
        purgeItems.run(cutoff);
        purgeIncidents.run(cutoff);
    }

    return { createIncident, getIncident, listIncidents, findRecentOpen, saveIncident, saveDeletedItem, listDeletedItems, claimDeletedItem, purgeOld };
}

module.exports = { createIncidentService, MAX_EVIDENCE, RETENTION_DAYS };
