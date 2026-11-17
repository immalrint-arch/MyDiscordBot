// Pure rules for channels. No Discord code, so they are easy to test.

// "General Chat" -> "general-chat" (text channels must be lowercase, no spaces).
function slugifyChannelName(input) {
    return String(input ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\s-]/gu, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 100);
}

// Voice channels and categories may keep capitals and spaces.
function cleanDisplayName(input) {
    return String(input ?? '').replace(/[\u0000-\u001f\u007f@#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

// Fills the room name template: {displayname}, {username}, {number}.
function renderRoomName(template, { displayname, username, number }) {
    const text = String(template ?? '')
        .replace(/\{displayname\}/gi, displayname ?? '')
        .replace(/\{username\}/gi, username ?? '')
        .replace(/\{number\}/gi, String(number ?? 1));
    return cleanDisplayName(text) || 'Voice room';
}

// What we keep from a category when saving a template. Only names, types, topics and
// simple settings: NEVER permission overwrites, because those hold role IDs of one server.
function buildTemplateSpec(category, children) {
    return {
        category: cleanDisplayName(category.name),
        channels: children.slice(0, 50).map((c) => ({
            name: String(c.name).slice(0, 100),
            type: c.type, // 'text' | 'voice' | 'announcement' | 'forum' | 'stage'
            topic: c.topic ? String(c.topic).slice(0, 1024) : null,
            nsfw: Boolean(c.nsfw),
            slowmode: Number(c.slowmode) || 0,
            userLimit: Number(c.userLimit) || 0,
        })),
    };
}

const CHANNEL_TYPES = ['text', 'voice', 'announcement', 'forum', 'stage'];

// Checks a template that came out of the database before we create anything from it.
function validateTemplateSpec(spec) {
    if (!spec || typeof spec !== 'object') return 'The template is damaged.';
    if (typeof spec.category !== 'string' || !spec.category) return 'The template has no category name.';
    if (!Array.isArray(spec.channels) || spec.channels.length === 0) return 'The template has no channels.';
    if (spec.channels.length > 50) return 'A template can have at most 50 channels.';
    for (const c of spec.channels) {
        if (!c || typeof c.name !== 'string' || !c.name) return 'A channel in the template has no name.';
        if (!CHANNEL_TYPES.includes(c.type)) return `Unknown channel type "${c.type}".`;
    }
    return null;
}

// Member may control a temporary room? Owner always; moderators with Manage Channels too.
const canControlRoom = ({ room, userId, hasManageChannels }) => Boolean(room) && (room.ownerId === userId || hasManageChannels);

module.exports = { slugifyChannelName, cleanDisplayName, renderRoomName, buildTemplateSpec, validateTemplateSpec, canControlRoom, CHANNEL_TYPES };
