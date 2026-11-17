// Builds the transcript file of a ticket. No Discord code here, so it is easy to test.
// Every piece of user text is escaped, so a message like <script> can never run in the file.
function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Only http(s) links may become clickable (blocks "javascript:" links).
function safeUrl(url) {
    return /^https?:\/\//i.test(url) ? escapeHtml(url) : '#';
}

// messages: [{ authorName, authorId, authorBot, avatarUrl, createdAt (ISO), content, attachments: [{name,url}], embedCount }]
function buildTranscriptHtml({ guildName, ticket, messages }) {
    const rows = messages.map((m) => {
        const attach = (m.attachments ?? []).map((a) => `<div class="att">📎 <a href="${safeUrl(a.url)}">${escapeHtml(a.name)}</a></div>`).join('');
        const embeds = m.embedCount ? `<div class="att">[${m.embedCount} embed(s) not shown]</div>` : '';
        return `<div class="msg"><img class="av" src="${safeUrl(m.avatarUrl ?? '')}" alt="">` +
            `<div><span class="name">${escapeHtml(m.authorName)}</span>${m.authorBot ? '<span class="bot">APP</span>' : ''} ` +
            `<span class="time">${escapeHtml(m.createdAt)}</span><div class="text">${escapeHtml(m.content)}</div>${attach}${embeds}</div></div>`;
    }).join('\n');

    return `<!doctype html><html><head><meta charset="utf-8"><title>Ticket #${ticket.number}</title>
<style>body{background:#1e1f22;color:#dbdee1;font-family:sans-serif;margin:0;padding:24px}h1{font-size:20px}
.msg{display:flex;gap:12px;margin:14px 0}.av{width:40px;height:40px;border-radius:50%;background:#404249}
.name{font-weight:600;color:#fff}.bot{background:#5865f2;color:#fff;font-size:10px;padding:1px 4px;border-radius:3px;margin-left:6px}
.time{color:#949ba4;font-size:12px}.text{white-space:pre-wrap;word-break:break-word}.att{margin-top:4px}a{color:#00a8fc}</style></head><body>
<h1>${escapeHtml(guildName)} — Ticket #${ticket.number}: ${escapeHtml(ticket.subject)}</h1>
<p>Opened by ${escapeHtml(ticket.openerName ?? ticket.openerId)} · ${messages.length} message(s)</p>
${rows}
</body></html>`;
}

module.exports = { buildTranscriptHtml, escapeHtml };
