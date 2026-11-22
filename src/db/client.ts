import { drizzle } from 'drizzle-orm/expo-sqlite';

import { migrate } from './migrations';
import * as schema from './schema';
import type { Db } from './types';

let db: Db | undefined;

/** The app database (opened and migrated synchronously on first use, so CarPlay-only launches can read it too). */
export function getDb(): Db {
  if (!db) {
    // Lazy require: unit tests inject an in-memory db with `setDb` and never load expo-sqlite.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy require, see above
    const { openDatabaseSync } = require('expo-sqlite') as typeof import('expo-sqlite');
    const raw = openDatabaseSync('sangeet.db');
    raw.execSync('PRAGMA journal_mode = WAL');
    const d = drizzle(raw, { schema }) as unknown as Db;
    migrate(d);
    db = d;
  }
  return db;
}

export function setDb(d: Db | undefined): void {
  db = d;
}
