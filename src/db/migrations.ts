import { sql } from 'drizzle-orm';

import type { Db } from './types';

/**
 * Ordered, append-only schema migrations. The applied count is stored in `PRAGMA user_version`, so running them is
 * idempotent. Each entry is a list of statements run in one transaction. Never edit an entry that has shipped.
 */
export const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE tracks (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE liked (track_id TEXT PRIMARY KEY NOT NULL, liked_at INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'local')`,
    `CREATE TABLE saved_collections (kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, saved_at INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'local', PRIMARY KEY (kind, id))`,
    `CREATE TABLE local_playlists (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE local_playlist_tracks (playlist_id TEXT NOT NULL, track_id TEXT NOT NULL, position INTEGER NOT NULL, added_at INTEGER NOT NULL, PRIMARY KEY (playlist_id, track_id))`,
    `CREATE INDEX lpt_order ON local_playlist_tracks (playlist_id, position)`,
    `CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, track_id TEXT NOT NULL, played_at INTEGER NOT NULL, source TEXT)`,
    `CREATE INDEX history_played ON history (played_at)`,
    `CREATE TABLE downloads (track_id TEXT PRIMARY KEY NOT NULL, state TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER NOT NULL DEFAULT 0, path TEXT, quality TEXT NOT NULL DEFAULT 'normal', error TEXT, attempts INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 1, group_kind TEXT, group_id TEXT, group_name TEXT, last_played_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`,
  ],
];

export function migrate(db: Db, migrations = MIGRATIONS): number {
  const current = Number((db.get(sql`PRAGMA user_version`) as { user_version: number } | undefined)?.user_version ?? 0);
  for (let v = current; v < migrations.length; v++) {
    db.run(sql.raw('BEGIN'));
    try {
      for (const stmt of migrations[v]) db.run(sql.raw(stmt));
      db.run(sql.raw(`PRAGMA user_version = ${v + 1}`));
      db.run(sql.raw('COMMIT'));
    } catch (e) {
      db.run(sql.raw('ROLLBACK'));
      throw e;
    }
  }
  return migrations.length;
}
