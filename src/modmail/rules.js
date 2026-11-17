// Pure helpers for modmail.
const MAX_FORWARD = 3800, MAX_ATTACHMENTS = 5;
const RELAY_COOLDOWN_MS = 1200, PICK_TTL_MS = 10 * 60 * 1000, TRANSCRIPT_MAX_MESSAGES = 500;
const INTERNAL_PREFIX = '//'; // staff messages starting with this are NOT sent to the member

const isInternal = (content) => String(content ?? '').trimStart().startsWith(INTERNAL_PREFIX);

// "modmail-sam-smith" (letters, numbers, dashes only; Discord needs lowercase)
function channelNameFor(username) {
    const clean = String(username ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    return `modmail-${clean || 'member'}`;
}

// Turns message text + attachments into one description for an embed. Returns { text, files } (files: names and links).
function prepareForward(content, attachments = []) {
    const files = attachments.slice(0, MAX_ATTACHMENTS).map((a) => ({ name: String(a.name ?? 'file').slice(0, 80), url: a.url }));
    let text = String(content ?? '').replace(/\u0000/g, '').trim();
    if (text.length > MAX_FORWARD) text = `${text.slice(0, MAX_FORWARD - 1)}…`;
    return { text, files, extra: Math.max(0, attachments.length - MAX_ATTACHMENTS) };
}
const hasBody = (content, attachments = []) => Boolean(String(content ?? '').trim()) || attachments.length > 0;

// lines: [{ at (ms), author, content, attachments: [{name,url}] }]
function formatTranscript({ guildName, thread, userLabel, closedByLabel, lines }) {
    const t = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
    const head = [`Modmail #${thread.id} · ${guildName}`, `Member: ${userLabel} (${thread.userId})`, `Opened: ${t(thread.openedAt)} UTC`, `Closed: ${t(thread.closedAt ?? Date.now())} UTC${closedByLabel ? ` by ${closedByLabel}` : ''}`, `Reason: ${thread.closeReason ?? 'No reason provided'}`, `Messages: ${lines.length}`, '-'.repeat(40)];
    const body = lines.flatMap((l) => [`[${t(l.at)}] ${l.author}: ${String(l.content ?? '').replace(/\r?\n/g, '\n    ')}`, ...(l.attachments ?? []).map((a) => `    📎 ${a.name}: ${a.url}`)]);
    return [...head, ...body].join('\n') + '\n';
}

module.exports = { MAX_FORWARD, MAX_ATTACHMENTS, RELAY_COOLDOWN_MS, PICK_TTL_MS, TRANSCRIPT_MAX_MESSAGES, INTERNAL_PREFIX, isInternal, channelNameFor, prepareForward, hasBody, formatTranscript };
