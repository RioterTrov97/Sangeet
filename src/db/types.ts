import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type * as schema from './schema';

/** Both expo-sqlite (app) and better-sqlite3 (tests) drivers are synchronous. */
export type Db = BaseSQLiteDatabase<'sync', any, typeof schema>;
