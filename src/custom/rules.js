// Pure rules for custom commands (tags) and auto-responders.
const NAME_RULE = /^[a-z0-9_-]{1,32}$/;
const MAX_RESPONSE = 1900;
const MAX_TAGS = 100, MAX_RESPONDERS = 50;
const MIN_TRIGGER = 2, MAX_TRIGGER = 100;
const MAX_COOLDOWN = 3600, DEFAULT_COOLDOWN = 30;
const MATCH_TYPES = ['contains', 'exact', 'starts', 'word'];

// Text for a reply: keeps line breaks, removes invisible control characters, and turns a typed "\n" into a line break
// (slash command boxes are one line, so people write \n where they want a new line).
function cleanBody(input, max = MAX_RESPONSE) {
    if (typeof input !== 'string') return null;
    const t = input.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
    if (!t) return null;
    return t.length > max ? null : t;
}
const normalize = (text) => String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordCache = new Map();
function wordRegex(trigger) {
    let r = wordCache.get(trigger);
    if (!r) { if (wordCache.size > 500) wordCache.clear(); r = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(trigger)}(?![\\p{L}\\p{N}_])`, 'u'); wordCache.set(trigger, r); }
    return r;
}
// Does a message match a trigger? (trigger is already normalised)
function matches(type, trigger, content) {
    const text = normalize(content); if (!text) return false;
    switch (type) {
        case 'exact': return text === trigger;
        case 'starts': return text.startsWith(trigger);
        case 'word': return wordRegex(trigger).test(text);
        default: return text.includes(trigger);
    }
}
// {user} {username} {server} {channel} {members} {args}
function render(template, { userId, username, server, channel, members, args = '' }) {
    return String(template).replace(/\{user\}/g, `<@${userId}>`).replace(/\{username\}/g, username).replace(/\{server\}/g, server).replace(/\{channel\}/g, channel ? `<#${channel}>` : '').replace(/\{members\}/g, String(members ?? '')).replace(/\{args\}/g, args).slice(0, 2000);
}

module.exports = { NAME_RULE, MAX_RESPONSE, MAX_TAGS, MAX_RESPONDERS, MIN_TRIGGER, MAX_TRIGGER, MAX_COOLDOWN, DEFAULT_COOLDOWN, MATCH_TYPES, cleanBody, normalize, matches, render };
