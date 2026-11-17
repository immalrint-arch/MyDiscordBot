const fs = require('node:fs');
const path = require('node:path');

// Applies every .sql file in `migrationsDir` that has not been applied yet,
// in alphabetical order (that is why the files start with 001_, 002_, ...).
// Returns the list of migrations applied during this call.
function runMigrations(db, migrationsDir) {
    // This table is the database's "diary" of which migrations already ran.
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name       TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);

    const alreadyApplied = new Set(
        db.prepare('SELECT name FROM schema_migrations').all().map((row) => row.name)
    );

    const files = fs.readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

    const appliedNow = [];

    for (const file of files) {
        if (alreadyApplied.has(file)) continue;

        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

        // A transaction means "all or nothing": if the migration fails halfway,
        // everything it did is undone, so the database is never left half-changed.
        db.exec('BEGIN');
        try {
            db.exec(sql);
            db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw new Error(`Migration ${file} failed: ${error.message}`);
        }

        appliedNow.push(file);
    }

    return appliedNow;
}

module.exports = { runMigrations };
