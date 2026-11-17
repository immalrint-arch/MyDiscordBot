const { isSnowflake } = require('../utils/snowflake');

const DEFAULT_WELCOME = 'Welcome, thank you for opening a ticket. Please state your reason.';
const DEFAULT_STAFF_TEXT = 'a new ticket needs help.';
const MAX_TEXT = 500;

function toTicket(row) {
    if (!row) return null;
    return {
        id: row.id, guildId: row.guild_id, number: row.ticket_number, channelId: row.channel_id,
        openerId: row.opener_id, subject: row.subject, status: row.status, claimedBy: row.claimed_by,
        closedBy: row.closed_by, closeReason: row.close_reason, rating: row.rating,
        createdAt: row.created_at, closedAt: row.closed_at,
    };
}

// Stores ticket settings, staff roles and the tickets themselves.
function createTicketService(db) {
    const insertGuild = db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)');
    const insertConfig = db.prepare('INSERT OR IGNORE INTO ticket_config (guild_id) VALUES (?)');
    const selectConfig = db.prepare('SELECT * FROM ticket_config WHERE guild_id = ?');
    const selectRoles = db.prepare('SELECT role_id FROM ticket_staff_roles WHERE guild_id = ?');
    const insertRole = db.prepare('INSERT OR IGNORE INTO ticket_staff_roles (guild_id, role_id) VALUES (?, ?)');
    const deleteRole = db.prepare('DELETE FROM ticket_staff_roles WHERE guild_id = ? AND role_id = ?');

    const insertTicket = db.prepare(`
        INSERT INTO tickets (guild_id, ticket_number, channel_id, opener_id, subject)
        VALUES (?, (SELECT COALESCE(MAX(ticket_number), 0) + 1 FROM tickets WHERE guild_id = ?), ?, ?, ?)
        RETURNING *
    `);
    const byId = db.prepare('SELECT * FROM tickets WHERE id = ?');
    const byChannel = db.prepare('SELECT * FROM tickets WHERE channel_id = ?');
    const countOpen = db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND opener_id = ? AND status = 'open'");
    const listOpenStmt = db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND status = 'open' ORDER BY ticket_number");
    // Every change below has a condition in its WHERE part, so two people clicking at the same moment cannot both win.
    const claimStmt = db.prepare("UPDATE tickets SET claimed_by = ? WHERE id = ? AND status = 'open' AND claimed_by IS NULL");
    const unclaimStmt = db.prepare("UPDATE tickets SET claimed_by = NULL WHERE id = ? AND status = 'open' AND claimed_by = ?");
    const closeStmt = db.prepare("UPDATE tickets SET status = 'closed', closed_by = ?, close_reason = ?, closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'open'");
    const rateStmt = db.prepare("UPDATE tickets SET rating = ? WHERE id = ? AND status = 'closed' AND rating IS NULL");
    const reopenStmt = db.prepare("UPDATE tickets SET status = 'open', closed_by = NULL, close_reason = NULL, closed_at = NULL, rating = NULL WHERE id = ? AND status = 'closed'");
    const deleteStmt = db.prepare('DELETE FROM tickets WHERE id = ?');

    function ensure(guildId) {
        if (!isSnowflake(guildId)) throw new TypeError('Invalid guild ID.');
        insertGuild.run(guildId);
        insertConfig.run(guildId);
    }

    function getConfig(guildId) {
        ensure(guildId);
        const row = selectConfig.get(guildId);
        return {
            guildId, enabled: row.enabled === 1, categoryId: row.category_id, logChannelId: row.log_channel_id,
            maxOpenPerUser: row.max_open_per_user, ratingsEnabled: row.ratings_enabled === 1,
            welcomeMessage: row.welcome_message ?? DEFAULT_WELCOME, staffMessage: row.staff_message ?? DEFAULT_STAFF_TEXT,
            askForm: row.ask_form === 1,
            staffRoleIds: selectRoles.all(guildId).map((r) => r.role_id),
        };
    }

    // `column` is always one of our own fixed names below, never user text.
    function setColumn(guildId, column, value) {
        ensure(guildId);
        db.prepare(`UPDATE ticket_config SET ${column} = ? WHERE guild_id = ?`).run(value, guildId);
    }

    return {
        getConfig,
        setEnabled: (g, v) => setColumn(g, 'enabled', v ? 1 : 0),
        setCategory: (g, id) => { if (id !== null && !isSnowflake(id)) throw new TypeError('Invalid category.'); setColumn(g, 'category_id', id); },
        setLogChannel: (g, id) => { if (id !== null && !isSnowflake(id)) throw new TypeError('Invalid channel.'); setColumn(g, 'log_channel_id', id); },
        setMaxOpen: (g, n) => { if (!Number.isInteger(n) || n < 1 || n > 10) throw new TypeError('Limit must be 1-10.'); setColumn(g, 'max_open_per_user', n); },
        setWelcome(g, { welcome, staffText }) {
            for (const t of [welcome, staffText]) if (t !== undefined && t !== null && (typeof t !== 'string' || t.length > MAX_TEXT)) throw new TypeError(`Text must be at most ${MAX_TEXT} characters.`);
            if (welcome !== undefined && welcome !== null) setColumn(g, 'welcome_message', welcome);
            if (staffText !== undefined && staffText !== null) setColumn(g, 'staff_message', staffText);
        },
        setAskForm: (g, v) => setColumn(g, 'ask_form', v ? 1 : 0),
        reopen: (id) => reopenStmt.run(id).changes > 0,
        setRatings: (g, v) => setColumn(g, 'ratings_enabled', v ? 1 : 0),
        addStaffRole(g, roleId) { if (!isSnowflake(roleId)) throw new TypeError('Invalid role.'); ensure(g); return insertRole.run(g, roleId).changes > 0; },
        removeStaffRole: (g, roleId) => deleteRole.run(g, roleId).changes > 0,

        createTicket({ guildId, channelId, openerId, subject }) {
            if (![guildId, channelId, openerId].every(isSnowflake)) throw new TypeError('Invalid Discord ID.');
            ensure(guildId);
            return toTicket(insertTicket.get(guildId, guildId, channelId, openerId, subject));
        },
        discardTicket: (id) => deleteStmt.run(id),
        getById: (id) => toTicket(byId.get(id)),
        getByChannel: (channelId) => toTicket(byChannel.get(channelId)),
        countOpenFor: (guildId, userId) => countOpen.get(guildId, userId).n,
        listOpen: (guildId) => listOpenStmt.all(guildId).map(toTicket),
        claim: (id, userId) => claimStmt.run(userId, id).changes > 0,
        unclaim: (id, userId) => unclaimStmt.run(id, userId).changes > 0,
        close: (id, closedBy, reason) => closeStmt.run(closedBy, reason, id).changes > 0,
        rate: (id, rating) => {
            if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new TypeError('Rating must be 1-5.');
            return rateStmt.run(rating, id).changes > 0;
        },
    };
}

module.exports = { createTicketService, DEFAULT_WELCOME, DEFAULT_STAFF_TEXT };
