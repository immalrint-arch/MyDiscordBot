const path = require('node:path');
const logger = require('../utils/logger');
const { getJsFiles } = require('../utils/getFiles');

// Finds every file in src/events and attaches it to the client.
function loadEvents(client) {
    const eventsDir = path.join(__dirname, '..', 'events');
    let count = 0;

    for (const file of getJsFiles(eventsDir)) {
        const event = require(file);

        if (!event.name || typeof event.execute !== 'function') {
            logger.warn(`Skipped ${path.basename(file)}: it needs "name" and "execute".`);
            continue;
        }

        // Wrap the event so an error inside it gets logged, not thrown.
        const run = async (...args) => {
            try {
                await event.execute(...args);
            } catch (error) {
                logger.error(`Error in event "${event.name}":`, error);
            }
        };

        if (event.once) {
            client.once(event.name, run);
        } else {
            client.on(event.name, run);
        }
        count++;
    }

    logger.info(`Loaded ${count} event(s).`);
}

module.exports = { loadEvents };