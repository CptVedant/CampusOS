import { config } from './config/env.js';
import { openDatabase } from './database/db.js';
import { runMigrations } from './database/migrate.js';
import { buildApp } from './app.js';

const db = openDatabase(config.databasePath);
const applied = runMigrations(db); // safe on a fresh or existing database
const app = buildApp({ config, db });
if (applied.length) app.log.info({ applied }, 'migrations applied');

async function shutdown(signal) {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    db.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
