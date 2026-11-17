const { isSnowflake } = require('../utils/snowflake');
const { MAX_REASON_LENGTH } = require('../utils/text');

const CASE_TYPES = ['warn', 'note', 'kick', 'ban', 'unban', 'softban', 'timeout', 'untimeout', 'quarantine', 'unquarantine'];
const MAX_PAGE_SIZE = 25;

// The database uses snake_case names; our code uses camelCase. This converts one row.
function toCase(row) {
    if (!row) return null;
    return {
        id: row.id,
        guildId: row.guild_id,
        caseNumber: row.case_number,
        type: row.type,
        targetId: row.target_id,
        moderatorId: row.moderator_id,
        reason: row.reason,
        durationMs: row.duration_ms,
        proofUrl: row.proof_url ?? null,
        active: row.active === 1,
        createdAt: row.created_at,
    };
}

function clampInteger(value, min, max) {
    const number = Number.isFinite(value) ? Math.trunc(value) : min;
    return Math.min(Math.max(number, min), max);
}

function createCaseService(db) {
    const insertGuild = db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)');

    // The case number is "highest number in this server + 1", worked out inside the
    // same statement that saves the case, so two cases can never get the same number.
    const insertCase = db.prepare(`
        INSERT INTO cases (guild_id, case_number, type, target_id, moderator_id, reason, duration_ms, proof_url)
        VALUES (?, (SELECT COALESCE(MAX(case_number), 0) + 1 FROM cases WHERE guild_id = ?), ?, ?, ?, ?, ?, ?)
        RETURNING *
    `);
    const selectCase = db.prepare('SELECT * FROM cases WHERE guild_id = ? AND case_number = ?');
    const listAll = db.prepare(
        'SELECT * FROM cases WHERE guild_id = ? ORDER BY case_number DESC LIMIT ? OFFSET ?'
    );
    const listByTarget = db.prepare(
        'SELECT * FROM cases WHERE guild_id = ? AND target_id = ? ORDER BY case_number DESC LIMIT ? OFFSET ?'
    );
    const countAll = db.prepare('SELECT COUNT(*) AS total FROM cases WHERE guild_id = ?');
    const countByTarget = db.prepare(
        'SELECT COUNT(*) AS total FROM cases WHERE guild_id = ? AND target_id = ?'
    );
    const selectActiveWarnings = db.prepare(
        "SELECT * FROM cases WHERE guild_id = ? AND target_id = ? AND type = 'warn' AND active = 1 ORDER BY case_number DESC LIMIT ?"
    );
    const pardonWarning = db.prepare(
        "UPDATE cases SET active = 0 WHERE guild_id = ? AND case_number = ? AND type = 'warn' AND active = 1"
    );
    const changeReason = db.prepare(
        'UPDATE cases SET reason = ? WHERE guild_id = ? AND case_number = ?'
    );

    function createCase({ guildId, type, targetId, moderatorId, reason = null, durationMs = null, proofUrl = null }) {
        if (!isSnowflake(guildId) || !isSnowflake(targetId) || !isSnowflake(moderatorId)) {
            throw new TypeError('Invalid Discord ID.');
        }
        if (!CASE_TYPES.includes(type)) {
            throw new TypeError(`Unknown case type: ${type}`);
        }
        if (reason !== null && (typeof reason !== 'string' || reason.length > MAX_REASON_LENGTH)) {
            throw new TypeError('Invalid reason.');
        }
        if (durationMs !== null && !(Number.isInteger(durationMs) && durationMs > 0)) {
            throw new TypeError('Invalid duration.');
        }

        if (proofUrl !== null && (typeof proofUrl !== 'string' || proofUrl.length > 1000 || !/^https:\/\//.test(proofUrl))) {
            throw new TypeError('Invalid proof link.');
        }

        insertGuild.run(guildId);
        return toCase(insertCase.get(guildId, guildId, type, targetId, moderatorId, reason, durationMs, proofUrl));
    }

    function getCase(guildId, caseNumber) {
        return toCase(selectCase.get(guildId, caseNumber));
    }

    // Newest first. Pass targetId to see only one person's cases.
    function listCases(guildId, { targetId = null, limit = 10, offset = 0 } = {}) {
        const safeLimit = clampInteger(limit, 1, MAX_PAGE_SIZE);
        const safeOffset = clampInteger(offset, 0, Number.MAX_SAFE_INTEGER);
        const rows = targetId
            ? listByTarget.all(guildId, targetId, safeLimit, safeOffset)
            : listAll.all(guildId, safeLimit, safeOffset);
        return rows.map(toCase);
    }

    function countCases(guildId, { targetId = null } = {}) {
        const row = targetId ? countByTarget.get(guildId, targetId) : countAll.get(guildId);
        return row.total;
    }

    function listActiveWarnings(guildId, targetId, limit = MAX_PAGE_SIZE) {
        return selectActiveWarnings.all(guildId, targetId, clampInteger(limit, 1, MAX_PAGE_SIZE)).map(toCase);
    }

    // How many active (not pardoned) warnings a member has; sinceIso = only count newer ones.
    const countWarnRows = db.prepare("SELECT COUNT(*) AS n FROM cases WHERE guild_id = ? AND target_id = ? AND type = 'warn' AND active = 1 AND (? IS NULL OR created_at >= ?)");
    function countActiveWarnings(guildId, targetId, sinceIso = null) { return countWarnRows.get(guildId, targetId, sinceIso, sinceIso).n; }

    // Returns true if a warning was pardoned, false if it didn't exist or was already pardoned.
    function deactivateWarning(guildId, caseNumber) {
        return pardonWarning.run(guildId, caseNumber).changes > 0;
    }

    function updateReason(guildId, caseNumber, reason) {
        if (reason !== null && (typeof reason !== 'string' || reason.length > MAX_REASON_LENGTH)) {
            throw new TypeError('Invalid reason.');
        }
        return changeReason.run(reason, guildId, caseNumber).changes > 0;
    }

    // How many actions each moderator took since a time. Manual moderation only: notes count as actions too.
    // Returns [{ moderatorId, total, byType: { ban: 2, warn: 5 } }], busiest first.
    const statsRows = db.prepare(`
        SELECT moderator_id, type, COUNT(*) AS n FROM cases
        WHERE guild_id = ? AND created_at >= ? AND (? IS NULL OR moderator_id = ?)
        GROUP BY moderator_id, type
    `);
    function moderatorStats(guildId, { sinceIso, moderatorId = null }) {
        const by = new Map();
        for (const r of statsRows.all(guildId, sinceIso, moderatorId, moderatorId)) {
            const entry = by.get(r.moderator_id) ?? { moderatorId: r.moderator_id, total: 0, byType: {} };
            entry.total += r.n; entry.byType[r.type] = r.n; by.set(r.moderator_id, entry);
        }
        return [...by.values()].sort((a, b) => b.total - a.total || a.moderatorId.localeCompare(b.moderatorId));
    }

    return {
        moderatorStats,
        createCase,
        getCase,
        listCases,
        countCases,
        listActiveWarnings,
        countActiveWarnings,
        deactivateWarning,
        updateReason,
    };
}

module.exports = { createCaseService, CASE_TYPES, MAX_PAGE_SIZE };
