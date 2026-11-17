// Remembers bans that must end on their own.
function createTempBanService(db) {
    const insertGuild = db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)');
    const upsert = db.prepare(`
        INSERT INTO temp_bans (guild_id, user_id, case_number, expires_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id, user_id) DO UPDATE SET case_number = excluded.case_number, expires_at = excluded.expires_at
    `);
    const selectDue = db.prepare('SELECT guild_id, user_id, case_number FROM temp_bans WHERE expires_at <= ? ORDER BY expires_at LIMIT 50');
    const remove = db.prepare('DELETE FROM temp_bans WHERE guild_id = ? AND user_id = ?');
    const selectOne = db.prepare('SELECT expires_at FROM temp_bans WHERE guild_id = ? AND user_id = ?');

    return {
        schedule(guildId, userId, caseNumber, expiresAtMs) {
            insertGuild.run(guildId);
            upsert.run(guildId, userId, caseNumber, new Date(expiresAtMs).toISOString());
        },
        due: (nowMs = Date.now()) => selectDue.all(new Date(nowMs).toISOString())
            .map((r) => ({ guildId: r.guild_id, userId: r.user_id, caseNumber: r.case_number })),
        clear: (guildId, userId) => remove.run(guildId, userId).changes > 0,
        get: (guildId, userId) => selectOne.get(guildId, userId)?.expires_at ?? null,
    };
}

module.exports = { createTempBanService };
