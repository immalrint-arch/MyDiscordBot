const path = require('node:path');
const logger = require('../utils/logger');
const { getJsFiles } = require('../utils/getFiles');

// Finds every file in src/commands and stores it in client.commands.
function loadCommands(client) {
    const commandsDir = path.join(__dirname, '..', 'commands');

    for (const file of getJsFiles(commandsDir)) {
        const command = require(file);

        // Every command file must export `data` and `execute`.
        if (!command.data || typeof command.execute !== 'function') {
            logger.warn(`Skipped ${path.basename(file)}: it needs "data" and "execute".`);
            continue;
        }
        client.commands.set(command.data.name, command);
    }

    logger.info(`Loaded ${client.commands.size} command(s).`);
}

module.exports = { loadCommands };