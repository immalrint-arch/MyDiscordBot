const { isSnowflake } = require('../utils/snowflake');

class BackupServiceError extends Error {} // safe to show
const MAX_MANUAL = 10, KEEP_AUTO = 3, DAY_MS = 86400000;

function createBackupService(db, { now = Date.now } = {}) {
    const ensure = (g) => { if (!isSnowflake(g)) throw new TypeError('Invalid server ID.'); db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(g); };
    const meta = (r) => (r ? { id: r.id, guildId: r.guild_id, name: r.name, createdAt: r.created_at, createdBy: r.created_by, auto: Boolean(r.auto), roles: r.roles, channels: r.channels, size: r.size } : null);
    const COLS = 'id, guild_id, name, created_at, created_by, auto, roles, channels, size';

    return {
        // data: the JSON text of the snapshot
        create(g, { name, by, data, roles, channels, auto = false }) {
            ensure(g); const cleanName = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || (auto ? 'Automatic backup' : 'Backup');
            if (!auto && db.prepare('SELECT COUNT(*) AS n FROM server_backups WHERE guild_id = ? AND auto = 0').get(g).n >= MAX_MANUAL) throw new BackupServiceError(`You can keep ${MAX_MANUAL} backups. Delete one with \`/serverbackup delete\` first.`);
            const id = Number(db.prepare('INSERT INTO server_backups (guild_id, name, created_at, created_by, auto, roles, channels, size, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(g, cleanName, now(), String(by), auto ? 1 : 0, roles, channels, Buffer.byteLength(data), data).lastInsertRowid);
            if (auto) db.prepare('DELETE FROM server_backups WHERE guild_id = ? AND auto = 1 AND id NOT IN (SELECT id FROM server_backups WHERE guild_id = ? AND auto = 1 ORDER BY id DESC LIMIT ?)').run(g, g, KEEP_AUTO);
            return id;
        },
        list: (g) => db.prepare(`SELECT ${COLS} FROM server_backups WHERE guild_id = ? ORDER BY id DESC`).all(g).map(meta),
        // always checks the server, so one server can never read another's backup
        getMeta: (g, id) => meta(db.prepare(`SELECT ${COLS} FROM server_backups WHERE guild_id = ? AND id = ?`).get(g, id)),
        getData: (g, id) => db.prepare('SELECT data FROM server_backups WHERE guild_id = ? AND id = ?').get(g, id)?.data ?? null,
        remove: (g, id) => Number(db.prepare('DELETE FROM server_backups WHERE guild_id = ? AND id = ?').run(g, id).changes) > 0,
        getAutoDays: (g) => db.prepare('SELECT auto_days FROM backup_config WHERE guild_id = ?').get(g)?.auto_days ?? 0,
        setAutoDays(g, days) {
            if (!Number.isInteger(days) || days < 0 || days > 30) throw new BackupServiceError('Days must be 0 (off) to 30.');
            ensure(g); db.prepare('INSERT INTO backup_config (guild_id, auto_days, last_auto_at) VALUES (?, ?, ?) ON CONFLICT (guild_id) DO UPDATE SET auto_days = excluded.auto_days').run(g, days, now());
        },
        // Exactly once per period: the first caller gets true and the timestamp moves forward.
        claimAuto(g, nowMs = now()) {
            const r = db.prepare('SELECT auto_days, last_auto_at FROM backup_config WHERE guild_id = ?').get(g); if (!r || !r.auto_days) return false;
            return Number(db.prepare('UPDATE backup_config SET last_auto_at = ? WHERE guild_id = ? AND auto_days > 0 AND (last_auto_at IS NULL OR last_auto_at <= ?)').run(nowMs, g, nowMs - r.auto_days * DAY_MS).changes) > 0;
        },
        autoGuilds: () => db.prepare('SELECT guild_id FROM backup_config WHERE auto_days > 0').all().map((r) => r.guild_id),
    };
}
module.exports = { createBackupService, BackupServiceError, MAX_MANUAL, KEEP_AUTO };
