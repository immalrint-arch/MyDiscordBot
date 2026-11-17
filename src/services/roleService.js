const { isSnowflake } = require('../utils/snowflake');

const MAX_PANELS = 20;
const MAX_OPTIONS = { button: 25, dropdown: 25, reaction: 20 };

class RoleServiceError extends Error {} // a message that is safe to show to a moderator

const assertId = (id, what) => { if (!isSnowflake(id)) throw new TypeError(`Invalid ${what}.`); };
const toPanel = (r) => !r ? null : ({
    id: r.id, guildId: r.guild_id, name: r.name, mode: r.mode, title: r.title, description: r.description,
    color: r.color, maxRoles: r.max_roles, requiredRoleId: r.required_role_id, allowRemove: r.allow_remove === 1,
    channelId: r.channel_id, messageId: r.message_id,
});
const toOption = (r) => ({ id: r.id, panelId: r.panel_id, roleId: r.role_id, label: r.label, emoji: r.emoji, description: r.description, position: r.position });

// Everything the role systems remember: panels, automatic roles and temporary roles.
function createRoleService(db) {
    const ensureGuild = (guildId) => { assertId(guildId, 'guild ID'); db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId); };

    // ---------- panels ----------
    function getPanel(guildId, name) {
        return toPanel(db.prepare('SELECT * FROM role_panels WHERE guild_id = ? AND name = ? COLLATE NOCASE').get(guildId, name));
    }
    function getPanelById(id) {
        return toPanel(db.prepare('SELECT * FROM role_panels WHERE id = ?').get(id));
    }
    function options(panelId) {
        return db.prepare('SELECT * FROM role_panel_options WHERE panel_id = ? ORDER BY position, id').all(panelId).map(toOption);
    }

    return {
        MAX_PANELS,
        MAX_OPTIONS,

        createPanel(guildId, { name, mode, title, description = null, color = 5793266, maxRoles = 0, requiredRoleId = null, allowRemove = true }) {
            ensureGuild(guildId);
            if (!['button', 'dropdown', 'reaction'].includes(mode)) throw new RoleServiceError('Unknown panel type.');
            if (getPanel(guildId, name)) throw new RoleServiceError(`A panel named **${name}** already exists.`);
            const count = db.prepare('SELECT COUNT(*) AS n FROM role_panels WHERE guild_id = ?').get(guildId).n;
            if (count >= MAX_PANELS) throw new RoleServiceError(`You can have at most ${MAX_PANELS} role panels.`);
            if (requiredRoleId) assertId(requiredRoleId, 'role');
            const info = db.prepare(
                `INSERT INTO role_panels (guild_id, name, mode, title, description, color, max_roles, required_role_id, allow_remove)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(guildId, name, mode, title ?? 'Pick your roles', description, color, maxRoles, requiredRoleId, allowRemove ? 1 : 0);
            return getPanelById(Number(info.lastInsertRowid));
        },
        getPanel,
        getPanelById,
        listPanels(guildId) {
            return db.prepare('SELECT * FROM role_panels WHERE guild_id = ? ORDER BY name COLLATE NOCASE').all(guildId).map(toPanel);
        },
        findPanelByMessage(messageId) {
            if (!isSnowflake(messageId)) return null;
            return toPanel(db.prepare('SELECT * FROM role_panels WHERE message_id = ?').get(messageId));
        },
        // `changes` may hold: title, description, color, maxRoles, requiredRoleId, allowRemove
        updatePanel(id, changes) {
            const map = { title: 'title', description: 'description', color: 'color', maxRoles: 'max_roles', requiredRoleId: 'required_role_id', allowRemove: 'allow_remove' };
            for (const [key, value] of Object.entries(changes)) {
                if (!map[key]) throw new TypeError(`Cannot change ${key}.`);
                const stored = typeof value === 'boolean' ? (value ? 1 : 0) : value;
                db.prepare(`UPDATE role_panels SET ${map[key]} = ? WHERE id = ?`).run(stored, id);
            }
            return getPanelById(id);
        },
        setPublished(id, channelId, messageId) {
            db.prepare('UPDATE role_panels SET channel_id = ?, message_id = ? WHERE id = ?').run(channelId, messageId, id);
        },
        deletePanel(id) { db.prepare('DELETE FROM role_panels WHERE id = ?').run(id); },

        options,
        addOption(panel, { roleId, label, emoji = null, description = null }) {
            assertId(roleId, 'role');
            const existing = options(panel.id);
            if (existing.some((o) => o.roleId === roleId)) throw new RoleServiceError('That role is already on this panel.');
            if (existing.length >= MAX_OPTIONS[panel.mode]) throw new RoleServiceError(`A ${panel.mode} panel can hold at most ${MAX_OPTIONS[panel.mode]} roles.`);
            if (emoji && existing.some((o) => o.emoji === emoji)) throw new RoleServiceError('That emoji is already used on this panel.');
            if (panel.mode === 'reaction' && !emoji) throw new RoleServiceError('Reaction panels need an emoji for every role.');
            db.prepare('INSERT INTO role_panel_options (panel_id, role_id, label, emoji, description, position) VALUES (?, ?, ?, ?, ?, ?)')
                .run(panel.id, roleId, label, emoji, description, existing.length);
        },
        removeOption(panelId, roleId) {
            return Number(db.prepare('DELETE FROM role_panel_options WHERE panel_id = ? AND role_id = ?').run(panelId, roleId).changes) > 0;
        },
        // When a role is deleted from the server, drop it from every panel.
        removeRoleEverywhere(guildId, roleId) {
            db.prepare('DELETE FROM role_panel_options WHERE role_id = ? AND panel_id IN (SELECT id FROM role_panels WHERE guild_id = ?)').run(roleId, guildId);
            db.prepare('DELETE FROM auto_roles WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
            db.prepare('DELETE FROM temp_roles WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
        },

        // ---------- automatic roles ----------
        addAutoRole(guildId, roleId, { target = 'humans', timing = 'join' } = {}) {
            ensureGuild(guildId); assertId(roleId, 'role');
            const count = db.prepare('SELECT COUNT(*) AS n FROM auto_roles WHERE guild_id = ?').get(guildId).n;
            const exists = db.prepare('SELECT 1 FROM auto_roles WHERE guild_id = ? AND role_id = ?').get(guildId, roleId);
            if (!exists && count >= 10) throw new RoleServiceError('You can have at most 10 automatic roles.');
            db.prepare(
                `INSERT INTO auto_roles (guild_id, role_id, target, timing) VALUES (?, ?, ?, ?)
                 ON CONFLICT (guild_id, role_id) DO UPDATE SET target = excluded.target, timing = excluded.timing`
            ).run(guildId, roleId, target, timing);
        },
        removeAutoRole(guildId, roleId) {
            return Number(db.prepare('DELETE FROM auto_roles WHERE guild_id = ? AND role_id = ?').run(guildId, roleId).changes) > 0;
        },
        listAutoRoles(guildId) {
            return db.prepare('SELECT * FROM auto_roles WHERE guild_id = ? ORDER BY role_id').all(guildId)
                .map((r) => ({ roleId: r.role_id, target: r.target, timing: r.timing }));
        },

        // ---------- temporary roles ----------
        addTempRole({ guildId, userId, roleId, expiresAt, addedBy, reason = null }) {
            ensureGuild(guildId); assertId(userId, 'user'); assertId(roleId, 'role');
            db.prepare(
                `INSERT INTO temp_roles (guild_id, user_id, role_id, expires_at, added_by, reason) VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT (guild_id, user_id, role_id) DO UPDATE SET expires_at = excluded.expires_at, added_by = excluded.added_by, reason = excluded.reason`
            ).run(guildId, userId, roleId, expiresAt, addedBy, reason);
        },
        clearTempRole(guildId, userId, roleId) {
            return Number(db.prepare('DELETE FROM temp_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?').run(guildId, userId, roleId).changes) > 0;
        },
        dueTempRoles(now = Date.now()) {
            return db.prepare('SELECT * FROM temp_roles WHERE expires_at <= ? ORDER BY expires_at LIMIT 100').all(now)
                .map((r) => ({ id: r.id, guildId: r.guild_id, userId: r.user_id, roleId: r.role_id, expiresAt: r.expires_at, reason: r.reason }));
        },
        listTempRoles(guildId, userId = null) {
            const rows = userId
                ? db.prepare('SELECT * FROM temp_roles WHERE guild_id = ? AND user_id = ? ORDER BY expires_at').all(guildId, userId)
                : db.prepare('SELECT * FROM temp_roles WHERE guild_id = ? ORDER BY expires_at LIMIT 50').all(guildId);
            return rows.map((r) => ({ userId: r.user_id, roleId: r.role_id, expiresAt: r.expires_at, addedBy: r.added_by, reason: r.reason }));
        },
    };
}

module.exports = { createRoleService, RoleServiceError, MAX_PANELS, MAX_OPTIONS };
