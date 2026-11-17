const logger = require('./logger');
const { CATEGORIES } = require('../help/catalog');

// Commands that are loaded but not in any help category are usually leftovers from an older version.
function unknownCommands(client) {
    const known = new Set(CATEGORIES.flatMap((c) => c.commands));
    return [...client.commands.keys()].filter((n) => !known.has(n));
}
function warnUnknownCommands(client) {
    const extra = unknownCommands(client);
    if (extra.length) logger.warn(`${extra.length} command(s) are not part of this version (old files?): ${extra.join(', ')}. Move their files out of src/commands, or Discord may refuse to register them (limit 100).`);
    if (client.commands.size > 100) logger.warn(`There are ${client.commands.size} commands but Discord allows only 100.`);
}
module.exports = { unknownCommands, warnUnknownCommands };
