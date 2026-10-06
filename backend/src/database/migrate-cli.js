import { config } from '../config/env.js';
import { openDatabase } from './db.js';
import { runMigrations } from './migrate.js';

const db = openDatabase(config.databasePath);
const ran = runMigrations(db);
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
db.close();
