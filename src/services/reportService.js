const { isSnowflake } = require('../utils/snowflake');

class ReportServiceError extends Error {} // safe to show to the member
const MAX_REASON = 1000;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 3;
const MAX_OPEN_AGAINST_SAME = 1; // one open report per reporter per target

function createReportService(db, { now = Date.now } = {}) {
    const assertId = (id, what = 'ID') => { if (!isSnowflake(id)) throw new TypeError(`Invalid ${what}.`); };
    const ensure = (guildId) => {
        assertId(guildId, 'guild ID');
        db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
        db.prepare('INSERT OR IGNORE INTO report_config (guild_id) VALUES (?)').run(guildId);
    };
    const toReport = (r) => (r ? { id: r.id, guildId: r.guild_id, number: r.report_number, reporterId: r.reporter_id, targetId: r.target_id, reason: r.reason, status: r.status,
        handledBy: r.handled_by, handledAt: r.handled_at, channelId: r.channel_id, messageId: r.message_id, createdAt: r.created_at } : null);

    return {
        MAX_PER_WINDOW,
        getConfig(guildId) {
            ensure(guildId);
            const r = db.prepare('SELECT channel_id, ping_role_id FROM report_config WHERE guild_id = ?').get(guildId);
            return { channelId: r.channel_id, pingRoleId: r.ping_role_id };
        },
        setConfig(guildId, { channelId, pingRoleId }) {
            ensure(guildId);
            if (channelId !== undefined) { if (channelId !== null) assertId(channelId, 'channel ID'); db.prepare('UPDATE report_config SET channel_id = ? WHERE guild_id = ?').run(channelId, guildId); }
            if (pingRoleId !== undefined) { if (pingRoleId !== null) assertId(pingRoleId, 'role ID'); db.prepare('UPDATE report_config SET ping_role_id = ? WHERE guild_id = ?').run(pingRoleId, guildId); }
        },
        create(guildId, { reporterId, targetId, reason }) {
            ensure(guildId); assertId(reporterId, 'reporter ID'); assertId(targetId, 'target ID');
            if (reporterId === targetId) throw new ReportServiceError('You cannot report yourself.');
            const text = typeof reason === 'string' ? reason.trim() : '';
            if (!text) throw new ReportServiceError('Please say what happened.');
            if (text.length > MAX_REASON) throw new ReportServiceError(`Keep it under ${MAX_REASON} characters.`);
            const since = new Date(now() - WINDOW_MS).toISOString();
            const recent = db.prepare('SELECT COUNT(*) AS n FROM reports WHERE guild_id = ? AND reporter_id = ? AND created_at >= ?').get(guildId, reporterId, since).n;
            if (recent >= MAX_PER_WINDOW) throw new ReportServiceError(`You can send ${MAX_PER_WINDOW} reports per hour. Please wait a bit.`);
            const same = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE guild_id = ? AND reporter_id = ? AND target_id = ? AND status = 'open'").get(guildId, reporterId, targetId).n;
            if (same >= MAX_OPEN_AGAINST_SAME) throw new ReportServiceError('You already have an open report about this person. Staff will look at it.');
            return toReport(db.prepare(`INSERT INTO reports (guild_id, report_number, reporter_id, target_id, reason, created_at)
                VALUES (?, (SELECT COALESCE(MAX(report_number), 0) + 1 FROM reports WHERE guild_id = ?), ?, ?, ?, ?) RETURNING *`)
                .get(guildId, guildId, reporterId, targetId, text, new Date(now()).toISOString()));
        },
        attachMessage(guildId, number, channelId, messageId) {
            db.prepare('UPDATE reports SET channel_id = ?, message_id = ? WHERE guild_id = ? AND report_number = ?').run(channelId, messageId, guildId, number);
        },
        // Turns an OPEN report into resolved/dismissed. Only the first click wins.
        close(guildId, number, status, handledBy) {
            if (!['resolved', 'dismissed'].includes(status)) throw new TypeError('Invalid status.');
            assertId(handledBy, 'moderator ID');
            return toReport(db.prepare("UPDATE reports SET status = ?, handled_by = ?, handled_at = ? WHERE guild_id = ? AND report_number = ? AND status = 'open' RETURNING *")
                .get(status, handledBy, new Date(now()).toISOString(), guildId, number));
        },
        get(guildId, number) { return toReport(db.prepare('SELECT * FROM reports WHERE guild_id = ? AND report_number = ?').get(guildId, number)); },
        countOpen: (guildId) => db.prepare("SELECT COUNT(*) AS n FROM reports WHERE guild_id = ? AND status = 'open'").get(guildId).n,
        // Removes a report whose staff message could not be posted (so the member can try again).
        discard(guildId, number) { db.prepare("DELETE FROM reports WHERE guild_id = ? AND report_number = ? AND status = 'open'").run(guildId, number); },
    };
}

module.exports = { createReportService, ReportServiceError };
