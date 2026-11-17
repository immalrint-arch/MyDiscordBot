const d = require('./detectors');

// Looks at one message and returns the first rule it breaks, or null.
// `rules` is the merged rule settings (see automodService.getConfig). Cheap checks come first.
function evaluate({ guildId, userId, content, mentionCount, rules, lists, tracker }) {
    const on = (name) => rules[name]?.enabled;

    if (content) {
        if (on('invites')) {
            const code = d.findInvite(content, lists.invite);
            if (code) return { rule: 'invites', detail: `invite code ${code}` };
        }
        if (on('links')) {
            const host = d.findLink(content, lists.domain);
            if (host) return { rule: 'links', detail: `link to ${host}` };
        }
        if (on('words')) {
            const word = d.findBannedWord(content, lists.word);
            if (word) return { rule: 'words', detail: 'banned word' }; // the word itself is not repeated in logs
        }
    }
    if (on('mentions') && mentionCount >= rules.mentions.limit) {
        return { rule: 'mentions', detail: `${mentionCount} mentions` };
    }
    if (content) {
        if (on('caps') && d.isExcessiveCaps(content, rules.caps.limit)) return { rule: 'caps', detail: 'mostly capital letters' };
        if (on('emojis') && d.countEmojis(content) >= rules.emojis.limit) return { rule: 'emojis', detail: `${d.countEmojis(content)} emojis` };
    }

    // The spam checks count this message too, so record it first.
    tracker.record(guildId, userId, content ?? '');
    if (on('duplicates')) {
        const copies = tracker.countDuplicates(guildId, userId, content ?? '', rules.duplicates.window);
        if (copies >= rules.duplicates.limit) return { rule: 'duplicates', detail: `${copies} identical messages` };
    }
    if (on('spam')) {
        const recent = tracker.countRecent(guildId, userId, rules.spam.window);
        if (recent >= rules.spam.limit) return { rule: 'spam', detail: `${recent} messages in ${rules.spam.window}s` };
    }
    return null;
}

module.exports = { evaluate };
