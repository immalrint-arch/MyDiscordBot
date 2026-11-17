// The auto-moderation rules, their default settings and what their numbers mean.
// limit/window: what "limit" and "window" mean for each rule (null = not used).
const RULES = {
    spam:       { label: 'Message spam',        enabled: true,  action: 'delete', limit: 5,  window: 5,    limitMeaning: 'messages', windowMeaning: 'seconds', limitRange: [2, 30], windowRange: [2, 60] },
    duplicates: { label: 'Repeated messages',   enabled: true,  action: 'delete', limit: 3,  window: 30,   limitMeaning: 'identical messages', windowMeaning: 'seconds', limitRange: [2, 10], windowRange: [5, 120] },
    mentions:   { label: 'Mass mentions',       enabled: true,  action: 'delete', limit: 5,  window: null, limitMeaning: 'mentions in one message', limitRange: [2, 30] },
    invites:    { label: 'Discord invites',     enabled: true,  action: 'delete', limit: null, window: null },
    links:      { label: 'Links',               enabled: false, action: 'delete', limit: null, window: null },
    words:      { label: 'Banned words',        enabled: true,  action: 'delete', limit: null, window: null },
    caps:       { label: 'Excessive CAPS',      enabled: true,  action: 'delete', limit: 70, window: null, limitMeaning: 'percent capital letters', limitRange: [50, 100] },
    emojis:     { label: 'Emoji spam',          enabled: false, action: 'delete', limit: 10, window: null, limitMeaning: 'emojis in one message', limitRange: [3, 50] },
    newaccount: { label: 'Suspicious new accounts', enabled: false, action: 'delete', limit: 3, window: null, limitMeaning: 'minimum account age in days', limitRange: [1, 90] },
};
const RULE_NAMES = Object.keys(RULES);

// What the person is told in the channel for each rule.
const NOTICE = {
    spam: 'please slow down, you are sending messages too fast.',
    duplicates: 'please do not repeat the same message.',
    mentions: 'please do not mention that many people at once.',
    invites: 'invite links are not allowed here.',
    links: 'links are not allowed here.',
    words: 'that language is not allowed here.',
    caps: 'please do not use so many capital letters.',
    emojis: 'please do not spam emojis.',
};

const ACTION_LABEL = { delete: 'Message deleted', timeout: 'Message deleted + timeout', kick: 'Message deleted + kick' };

module.exports = { RULES, RULE_NAMES, NOTICE, ACTION_LABEL };
