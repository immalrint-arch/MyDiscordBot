require('dotenv').config();

const { REST, Routes } = require('discord.js');
const path = require('node:path');
const logger = require('./utils/logger');
const { getJsFiles } = require('./utils/getFiles');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
    logger.error('DISCORD_TOKEN and CLIENT_ID must be set in your .env file.');
    process.exit(1);
}

// Collect the JSON description of every command
const commands = [];
for (const file of getJsFiles(path.join(__dirname, 'commands'))) {
    const command = require(file);
    if (command.data && typeof command.execute === 'function') {
        commands.push(command.data.toJSON());
    } else {
        logger.warn(`Skipped ${path.basename(file)}: it needs "data" and "execute".`);
    }
}

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
    try {
        // With GUILD_ID: commands appear instantly in that one server (best for development).
        // Without it: commands are registered globally (can take a while to show up).
        const route = GUILD_ID
            ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
            : Routes.applicationCommands(CLIENT_ID);

        const result = await rest.put(route, { body: commands });
        logger.info(`Registered ${result.length} command(s) ${GUILD_ID ? 'in your test server' : 'globally'}.`);
    } catch (error) {
        logger.error('Failed to deploy commands:', error.message);
        process.exit(1);
    }
})();