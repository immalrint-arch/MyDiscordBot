// Pure rules for confessions (no Discord code).
const MAX_LENGTH = 1800;
const COOLDOWN_MIN = 10, COOLDOWN_MAX = 3600, COOLDOWN_DEFAULT = 60;
// Embed side-bar colours: purple, green, blue, pink, orange, teal... (like the reference, each confession can differ)
const COLORS = [0x6c4ab6, 0x3ba55d, 0x3b82f6, 0xe91e8c, 0xe67e22, 0x1abc9c, 0xe74c3c, 0xf1c40f];
const pickColor = (rng = Math.random) => COLORS[Math.min(COLORS.length - 1, Math.floor(rng() * COLORS.length))];

const INVITE = /(discord\.gg|discord(?:app)?\.com\/invite|discord\.me|dsc\.gg)\/\S+/i;

// Cleans what the member typed. Returns { ok: true, text } or { ok: false, problem }.
function cleanConfession(input) {
    if (typeof input !== 'string') return { ok: false, problem: 'Write something first.' };
    let text = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '') // control + invisible direction tricks
        .replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return { ok: false, problem: 'Write something first.' };
    if (text.length > MAX_LENGTH) return { ok: false, problem: `That is too long. The limit is ${MAX_LENGTH} characters (yours: ${text.length}).` };
    if (INVITE.test(text)) return { ok: false, problem: 'Server invite links are not allowed in confessions.' };
    text = text.replace(/@(everyone|here)/gi, '@​$1'); // can never ping anyone
    return { ok: true, text };
}

// "How long until I can confess again?" in seconds (0 = now).
function cooldownLeft(lastIso, cooldownSeconds, nowMs) {
    if (!lastIso) return 0;
    return Math.max(0, Math.ceil((new Date(lastIso).getTime() + cooldownSeconds * 1000 - nowMs) / 1000));
}

module.exports = { MAX_LENGTH, COOLDOWN_MIN, COOLDOWN_MAX, COOLDOWN_DEFAULT, COLORS, pickColor, cleanConfession, cooldownLeft };
