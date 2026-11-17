// Pure rules for the invite tracker, sticky roles and member counters.
const FAKE_ACCOUNT_DAYS = 7;
const SAVED_ROLES_MAX_AGE_MS = 90 * 86400000;
const MAX_COUNTERS = 5, COUNTER_MIN_GAP_MS = 10 * 60 * 1000, MAX_TEMPLATE = 90;
const TOKENS = { members: 'everyone in the server', humans: 'people (no bots)', bots: 'bots', boosts: 'number of boosts', boostlevel: 'boost level (0-3)', channels: 'number of channels', roles: 'number of roles' };

// Invites before and after a join: which one gained a use? before = Map(code -> {uses, maxUses, inviterId}); after = array of { code, uses, maxUses, inviterId }.
function detectInvite(before, after) {
    const afterCodes = new Set(after.map((i) => i.code));
    const gained = after.filter((i) => (i.uses ?? 0) > (before.get(i.code)?.uses ?? 0));
    if (gained.length === 1) return { code: gained[0].code, inviterId: gained[0].inviterId ?? null };
    if (gained.length > 1) return null; // two joins at once: cannot tell
    // an invite that was used up (max uses reached) disappears
    const gone = [...before].filter(([code, v]) => !afterCodes.has(code) && v.maxUses > 0 && (v.uses ?? 0) + 1 >= v.maxUses);
    return gone.length === 1 ? { code: gone[0][0], inviterId: gone[0][1].inviterId ?? null } : null;
}
const isFakeAccount = (createdTimestamp, joinedAt) => joinedAt - createdTimestamp < FAKE_ACCOUNT_DAYS * 86400000;

// Template like "Members: {members}". Returns the text, or null when a number is not known right now.
function validTemplate(t) {
    const text = String(t ?? '').trim(); if (!text || text.length > MAX_TEMPLATE) return { problem: `The text must be 1 to ${MAX_TEMPLATE} characters.` };
    const used = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]); if (!used.length) return { problem: 'Put at least one {members} style number in the text.' };
    const bad = used.find((u) => !(u in TOKENS)); if (bad) return { problem: `{${bad}} is not known. Use: ${Object.keys(TOKENS).map((k) => `{${k}}`).join(' ')}` };
    return { template: text };
}
function renderTemplate(template, stats) {
    let missing = false;
    const out = template.replace(/\{(\w+)\}/g, (_, k) => { const v = stats[k]; if (v === undefined || v === null) { missing = true; return ''; } return Number(v).toLocaleString('en-US'); });
    return missing ? null : out.slice(0, 100);
}
// Roles that must never be given back automatically.
const DANGEROUS = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'ManageMessages', 'KickMembers', 'BanMembers', 'ModerateMembers', 'MentionEveryone', 'ManageNicknames', 'ManageEvents', 'ManageThreads'];
const isDangerousRole = (role, flags) => DANGEROUS.some((n) => flags[n] !== undefined && role.permissions?.has?.(flags[n]));

module.exports = { FAKE_ACCOUNT_DAYS, SAVED_ROLES_MAX_AGE_MS, MAX_COUNTERS, COUNTER_MIN_GAP_MS, MAX_TEMPLATE, TOKENS, DANGEROUS, detectInvite, isFakeAccount, validTemplate, renderTemplate, isDangerousRole };
