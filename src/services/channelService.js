const { isSnowflake } = require('../utils/snowflake');

class ChannelServiceError extends Error {}

const MAX_TEMPLATES = 25;
const MAX_TEMP_ROOMS = 50;

// Remembers channel templates and the temporary voice room settings.
function createChannelService(db, { now = Date.now } = {}) {
    const ensureGuild = (guildId) => {
        if (!isSnowflake(guildId)) throw new TypeError('Invalid guild ID.');
        db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
    };
    const toTemplate = (r) => !r ? null : ({ id: r.id, guildId: r.guild_id, name: r.name, spec: JSON.parse(r.spec), createdBy: r.created_by, createdAt: r.created_at });

    function ensureVoiceConfig(guildId) {
        ensureGuild(guildId);
        db.prepare('INSERT OR IGNORE INTO tempvoice_config (guild_id) VALUES (?)').run(guildId);
    }
    const toVoiceConfig = (r) => ({
        enabled: r.enabled === 1, triggerChannelId: r.trigger_channel_id, categoryId: r.category_id,
        nameTemplate: r.name_template, defaultLimit: r.default_limit,
    });

    return {
        MAX_TEMPLATES,
        MAX_TEMP_ROOMS,

        // ---------- templates ----------
        saveTemplate(guildId, name, spec, createdBy) {
            ensureGuild(guildId);
            const count = db.prepare('SELECT COUNT(*) AS n FROM channel_templates WHERE guild_id = ?').get(guildId).n;
            const exists = this.getTemplate(guildId, name);
            if (!exists && count >= MAX_TEMPLATES) throw new ChannelServiceError(`You can save at most ${MAX_TEMPLATES} templates.`);
            if (exists) {
                // Names ignore capitals, so "Games" and "games" are the same template.
                db.prepare('UPDATE channel_templates SET spec = ?, created_by = ? WHERE id = ?').run(JSON.stringify(spec), createdBy, exists.id);
            } else {
                db.prepare('INSERT INTO channel_templates (guild_id, name, spec, created_by) VALUES (?, ?, ?, ?)').run(guildId, name, JSON.stringify(spec), createdBy);
            }
        },
        getTemplate(guildId, name) {
            return toTemplate(db.prepare('SELECT * FROM channel_templates WHERE guild_id = ? AND name = ? COLLATE NOCASE').get(guildId, name));
        },
        listTemplates(guildId) {
            return db.prepare('SELECT * FROM channel_templates WHERE guild_id = ? ORDER BY name COLLATE NOCASE').all(guildId).map(toTemplate);
        },
        deleteTemplate(guildId, name) {
            return Number(db.prepare('DELETE FROM channel_templates WHERE guild_id = ? AND name = ? COLLATE NOCASE').run(guildId, name).changes) > 0;
        },

        // ---------- temporary voice settings ----------
        getVoiceConfig(guildId) {
            ensureVoiceConfig(guildId);
            return toVoiceConfig(db.prepare('SELECT * FROM tempvoice_config WHERE guild_id = ?').get(guildId));
        },
        setVoiceConfig(guildId, changes) {
            ensureVoiceConfig(guildId);
            const map = { enabled: 'enabled', triggerChannelId: 'trigger_channel_id', categoryId: 'category_id', nameTemplate: 'name_template', defaultLimit: 'default_limit' };
            for (const [key, value] of Object.entries(changes)) {
                if (!map[key]) throw new TypeError(`Cannot change ${key}.`);
                if ((key === 'triggerChannelId' || key === 'categoryId') && value !== null && !isSnowflake(value)) throw new TypeError('Invalid channel.');
                if (key === 'defaultLimit' && (!Number.isInteger(value) || value < 0 || value > 99)) throw new TypeError('Limit must be 0-99.');
                db.prepare(`UPDATE tempvoice_config SET ${map[key]} = ? WHERE guild_id = ?`).run(typeof value === 'boolean' ? (value ? 1 : 0) : value, guildId);
            }
        },

        // ---------- temporary rooms ----------
        addRoom(guildId, channelId, ownerId) {
            ensureGuild(guildId);
            db.prepare('INSERT OR REPLACE INTO tempvoice_channels (channel_id, guild_id, owner_id, created_at) VALUES (?, ?, ?, ?)').run(channelId, guildId, ownerId, now());
        },
        getRoom(channelId) {
            const r = db.prepare('SELECT * FROM tempvoice_channels WHERE channel_id = ?').get(channelId);
            return r ? { channelId: r.channel_id, guildId: r.guild_id, ownerId: r.owner_id, createdAt: r.created_at } : null;
        },
        setRoomOwner(channelId, ownerId) { db.prepare('UPDATE tempvoice_channels SET owner_id = ? WHERE channel_id = ?').run(ownerId, channelId); },
        removeRoom(channelId) { db.prepare('DELETE FROM tempvoice_channels WHERE channel_id = ?').run(channelId); },
        countRooms(guildId) { return db.prepare('SELECT COUNT(*) AS n FROM tempvoice_channels WHERE guild_id = ?').get(guildId).n; },
        listRooms(guildId = null) {
            const rows = guildId
                ? db.prepare('SELECT * FROM tempvoice_channels WHERE guild_id = ?').all(guildId)
                : db.prepare('SELECT * FROM tempvoice_channels').all();
            return rows.map((r) => ({ channelId: r.channel_id, guildId: r.guild_id, ownerId: r.owner_id }));
        },
    };
}

module.exports = { createChannelService, ChannelServiceError, MAX_TEMPLATES, MAX_TEMP_ROOMS };
