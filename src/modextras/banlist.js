// Pure helpers for exporting and importing ban lists.
const MAX_IMPORT = 300, MAX_FILE_BYTES = 1_000_000;

const csv = (s) => `"${String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, '""')}"`;
// bans: [{ id, username, reason }]
function formatBanList(bans, { guildName = 'server', now = Date.now() } = {}) {
    return [`# Incomu ban list · ${String(guildName).replace(/[\r\n]+/g, ' ')} · ${new Date(now).toISOString().slice(0, 10)} · ${bans.length} ban${bans.length === 1 ? '' : 's'}`, 'user_id,username,reason',
        ...bans.map((b) => `${b.id},${csv(b.username)},${csv(b.reason)}`)].join('\n') + '\n';
}
// Takes the first 17-20 digit number at the start of each line, so it reads our files AND plain lists (one ID per line). Returns { ids (unique), skipped (lines that were not comments or empty and had no ID) }.
function parseBanFile(text) {
    const ids = []; const seen = new Set(); let skipped = 0;
    for (const raw of String(text ?? '').replace(/^﻿/, '').split(/\r?\n/)) {
        const line = raw.trim(); if (!line || line.startsWith('#') || /^user_?id\b/i.test(line)) continue;
        const m = /^["']?(\d{17,20})["']?(?=$|[\s,;\t])/.exec(line);
        if (!m) { skipped++; continue; }
        if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
    }
    return { ids, skipped };
}
// Only download files that really come from Discord's own file servers.
function isDiscordFileUrl(url) {
    try { const u = new URL(url); return u.protocol === 'https:' && ['cdn.discordapp.com', 'media.discordapp.net'].includes(u.hostname); } catch { return false; }
}
const fileLooksLikeText = (a) => /\.(txt|csv)$/i.test(a?.name ?? '') || /^text\//.test(a?.contentType ?? '');

module.exports = { MAX_IMPORT, MAX_FILE_BYTES, formatBanList, parseBanFile, isDiscordFileUrl, fileLooksLikeText };
