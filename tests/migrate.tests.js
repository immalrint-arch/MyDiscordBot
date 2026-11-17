const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDatabase, MIGRATIONS_DIR } = require('../src/database');
const { runMigrations } = require('../src/database/migrate');

function tableNames(db) {
    return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
}

test('migrations create the expected tables', () => {
    const db = openDatabase(':memory:');
    runMigrations(db, MIGRATIONS_DIR);
    const tables = tableNames(db);
    assert.ok(tables.includes('guilds'));
    assert.ok(tables.includes('guild_settings'));
    assert.ok(tables.includes('schema_migrations'));
});

test('running migrations twice applies nothing the second time', () => {
    const db = openDatabase(':memory:');
    const first = runMigrations(db, MIGRATIONS_DIR);
    const second = runMigrations(db, MIGRATIONS_DIR);
    assert.ok(first.length >= 1);
    assert.deepStrictEqual(second, []);
});

test('a failing migration is rolled back and reported', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migr-'));
    fs.writeFileSync(
        path.join(dir, '001_bad.sql'),
        'CREATE TABLE should_not_exist (id INTEGER); THIS IS NOT VALID SQL;'
    );
    const db = openDatabase(':memory:');

    assert.throws(() => runMigrations(db, dir), /Migration 001_bad\.sql failed/);
    assert.ok(!tableNames(db).includes('should_not_exist'), 'partial changes must be undone');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 0);

    fs.rmSync(dir, { recursive: true, force: true });
});