const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite'); // SQLite built into Node.js
const logger = require('../utils/logger');
const { runMigrations } = require('./migrate');

const DEFAULT_DB_PATH = path.join(__dirname, '..', '..', 'data', 'bot.sqlite');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Opens (or creates) the database file and turns on safety features.
function openDatabase(filePath = DEFAULT_DB_PATH) {
    const inMemory = filePath === ':memory:'; // ':memory:' is used by tests
    if (!inMemory) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    const db = new DatabaseSync(filePath);
    db.exec('PRAGMA foreign_keys = ON;'); // enforce links between tables
    if (!inMemory) {
        db.exec('PRAGMA journal_mode = WAL;'); // safer and faster writes
    }
    return db;
}

// Opens the database and brings it up to date. Called once at startup.
function initDatabase(filePath) {
    const db = openDatabase(filePath);
    const applied = runMigrations(db, MIGRATIONS_DIR);

    if (applied.length > 0) {
        logger.info(`Applied ${applied.length} database migration(s): ${applied.join(', ')}`);
    } else {
        logger.info('Database is up to date.');
    }
    return db;
}

module.exports = { openDatabase, initDatabase, MIGRATIONS_DIR };
