import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Applies pending *.sql migrations in filename order. Each migration runs in its own
 * transaction together with its bookkeeping row, so a failure leaves no partial state.
 * Applied migrations are never re-run; to change the schema, add a new file.
 */
export function runMigrations(db, dir = MIGRATIONS_DIR) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);

  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').pluck().all());
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const insert = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');
  const ran = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      insert.run(file);
    })();
    ran.push(file);
  }
  return ran;
}
