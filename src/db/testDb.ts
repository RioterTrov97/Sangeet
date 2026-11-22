import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';

import { migrate } from './migrations';
import * as schema from './schema';
import type { Db } from './types';

/** In-memory database for unit tests (same schema, same migrations as the app). */
export function memoryDb(): Db {
  const db = drizzle(new Database(':memory:'), { schema }) as unknown as Db;
  migrate(db);
  return db;
}
