const { isSnowflake } = require('../utils/snowflake');
const { parseEmojiInput } = require('../utility/rules');

class StarboardServiceError extends Error {}

function createStarboardService(db) {
    const ensure = (guildId) => {
        if (!isSnowflake(guildId)) throw new TypeError('Invalid guild ID.');
        db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
        db.prepare('INSERT OR IGNORE INTO starboard_config (guild_id) VALUES (?)').run(guildId);
    };
    const toPost = (r) => (r ? { guildId: r.guild_id, sourceMessageId: r.source_message_id, sourceChannelId: r.source_channel_id, starChannelId: r.star_channel_id, starMessageId: r.star_message_id, stars: r.stars } : null);
    return {
        getConfig(guildId) {
            ensure(guildId);
            const r = db.prepare('SELECT * FROM starboard_config WHERE guild_id = ?').get(guildId);
            return { channelId: r.channel_id, threshold: r.threshold, emoji: r.emoji };
        },
        setup(guildId, { channelId, threshold, emoji }) {
            ensure(guildId);
            if (channelId !== undefined) { if (channelId !== null && !isSnowflake(channelId)) throw new TypeError('Invalid channel ID.'); db.prepare('UPDATE starboard_config SET channel_id = ? WHERE guild_id = ?').run(channelId, guildId); }
            if (threshold !== undefined && threshold !== null) {
                if (!Number.isInteger(threshold) || threshold < 1 || threshold > 50) throw new StarboardServiceError('The number of stars must be between 1 and 50.');
                db.prepare('UPDATE starboard_config SET threshold = ? WHERE guild_id = ?').run(threshold, guildId);
            }
            if (emoji !== undefined && emoji !== null) {
                const e = parseEmojiInput(emoji); if (!e) throw new StarboardServiceError('Use a normal emoji like ⭐ or a custom emoji from this server.');
                db.prepare('UPDATE starboard_config SET emoji = ? WHERE guild_id = ?').run(e, guildId);
            }
        },
        getPost: (guildId, sourceMessageId) => toPost(db.prepare('SELECT * FROM starboard_posts WHERE guild_id = ? AND source_message_id = ?').get(guildId, sourceMessageId)),
        savePost(guildId, { sourceMessageId, sourceChannelId, starChannelId, starMessageId, stars }) {
            ensure(guildId);
            db.prepare(`INSERT INTO starboard_posts (guild_id, source_message_id, source_channel_id, star_channel_id, star_message_id, stars) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (guild_id, source_message_id) DO UPDATE SET stars = excluded.stars, star_message_id = excluded.star_message_id, star_channel_id = excluded.star_channel_id`)
                .run(guildId, sourceMessageId, sourceChannelId, starChannelId, starMessageId, stars);
        },
        deletePost: (guildId, sourceMessageId) => db.prepare('DELETE FROM starboard_posts WHERE guild_id = ? AND source_message_id = ?').run(guildId, sourceMessageId),
        countPosts: (guildId) => db.prepare('SELECT COUNT(*) AS n FROM starboard_posts WHERE guild_id = ?').get(guildId).n,
    };
}

module.exports = { createStarboardService, StarboardServiceError };
