// Pure helpers for Milestone 12 (no Discord code, so they are easy to test).
const { isSnowflake } = require('../utils/snowflake');

// ---- quarantine ----
// Which roles are taken away and which stay.
//   roles: [{ id, managed, isEveryone, position }]  (the member's current roles)
// Managed roles (bot roles, Nitro booster, integrations) cannot be removed by hand, so they stay.
// Returns { saved: [ids to give back later], keep: [ids that stay], final: [ids the member will have] }.
function planQuarantine(roles, quarantineRoleId, botHighestPosition = Infinity) {
    const saved = []; const keep = [];
    for (const r of roles) {
        if (r.isEveryone || r.id === quarantineRoleId) continue;
        (r.managed || (r.position ?? 0) >= botHighestPosition ? keep : saved).push(r.id); // roles the bot cannot remove stay
    }
    return { saved, keep, final: [...keep, quarantineRoleId] };
}
// Which saved roles can be given back now. Roles that were deleted, or are above the bot's highest role, are skipped (and counted).
//   existing: Map(id -> { managed, position })
function planRestore(savedIds, existing, botHighestPosition) {
    const give = []; let skipped = 0;
    for (const id of savedIds) {
        const r = existing.get(id);
        if (!r || r.managed || r.position >= botHighestPosition) { skipped++; continue; }
        give.push(id);
    }
    return { give, skipped };
}

// ---- nickname cleanup ----
const HOIST = /^[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~ -⁯⸀-⹿]+/; // symbols that sort a name to the top of the list
// Cleans a display name: fancy letters become normal ones, zalgo/invisible characters go, top-sorting symbols go.
// Returns the clean name, or null if nothing usable is left.
function cleanNickname(name) {
    if (typeof name !== 'string') return null;
    let s = name.replace(/(\p{L}|\p{N})\p{M}{3,}/gu, '$1'); // zalgo: a letter buried under 3+ stacked marks goes (normal accents like é and other scripts stay)
    s = s.normalize('NFKC');                           // 𝕱𝖆𝖓𝖈𝖞 -> Fancy
    s = s.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}⠀ㅤᅟᅠ]/gu, ''); // control, invisible, private-use, blank braille/hangul fillers
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(HOIST, '').trim();
    s = [...s].slice(0, 32).join('').trim();
    return s.length >= 1 && /[\p{L}\p{N}]/u.test(s) ? s : null;
}
const fallbackNickname = (userId) => `Moderated ${String(userId).slice(-4)}`;
// What to set: { change: false } if already clean, otherwise { change: true, to }.
function planNickname(displayName, userId) {
    const cleaned = cleanNickname(displayName);
    const to = cleaned ?? fallbackNickname(userId);
    return to === displayName ? { change: false } : { change: true, to };
}

// ---- massban ----
const MAX_MASSBAN = 100;
// Reads IDs out of any pasted text (spaces, commas, new lines, mentions). Returns { ids (unique, in order), leftover (words that were not IDs) }.
function parseIdList(text) {
    const ids = []; const seen = new Set(); const rest = [];
    for (const token of String(text ?? '').split(/[\s,;]+/).filter(Boolean)) {
        const m = token.match(/^<@!?(\d{17,20})>$/) ?? token.match(/^(\d{17,20})$/);
        if (m && isSnowflake(m[1])) { if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); } } else rest.push(token);
    }
    return { ids, leftover: rest.join(' ') };
}

// ---- voice ----
const VOICE_ACTIONS = ['kick', 'mute', 'unmute', 'deafen', 'undeafen', 'move'];

module.exports = { planQuarantine, planRestore, cleanNickname, planNickname, fallbackNickname, parseIdList, MAX_MASSBAN, VOICE_ACTIONS };
