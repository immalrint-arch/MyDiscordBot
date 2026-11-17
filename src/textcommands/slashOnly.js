// Commands that must NOT work when typed. Typing "!confess secret" would show the secret (and the author) in public chat.
const SLASH_ONLY = new Set(['textcommands', 'confess', 'confession', 'play', 'banlist']);
module.exports = { SLASH_ONLY };
