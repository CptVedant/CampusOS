import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { PRAGMAS } from '../config/database.js';

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  for (const pragma of PRAGMAS) db.pragma(pragma);
  return db;
}
