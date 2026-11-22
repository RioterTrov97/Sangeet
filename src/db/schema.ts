import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Metadata cache: every track we have seen in the library, history, playlists or downloads. `json` is a full `Track`. */
export const tracks = sqliteTable('tracks', {
  id: text('id').primaryKey(),
  json: text('json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** `source` is 'local' for likes made in the app and 'yt' for rows mirrored from a signed-in YouTube Music account. */
export const liked = sqliteTable('liked', {
  trackId: text('track_id').primaryKey(),
  likedAt: integer('liked_at').notNull(),
  source: text('source').notNull().default('local'),
});

export const savedCollections = sqliteTable(
  'saved_collections',
  {
    kind: text('kind').notNull(), // album | playlist | artist
    id: text('id').notNull(),
    json: text('json').notNull(),
    savedAt: integer('saved_at').notNull(),
    source: text('source').notNull().default('local'),
  },
  (t) => [primaryKey({ columns: [t.kind, t.id] })],
);

export const localPlaylists = sqliteTable('local_playlists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const localPlaylistTracks = sqliteTable(
  'local_playlist_tracks',
  {
    playlistId: text('playlist_id').notNull(),
    trackId: text('track_id').notNull(),
    position: integer('position').notNull(),
    addedAt: integer('added_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.playlistId, t.trackId] }), index('lpt_order').on(t.playlistId, t.position)],
);

export const history = sqliteTable(
  'history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    trackId: text('track_id').notNull(),
    playedAt: integer('played_at').notNull(),
    source: text('source'),
  },
  (t) => [index('history_played').on(t.playedAt)],
);

export type DownloadState = 'queued' | 'downloading' | 'done' | 'failed';

export const downloads = sqliteTable('downloads', {
  trackId: text('track_id').primaryKey(),
  state: text('state').$type<DownloadState>().notNull(),
  bytes: integer('bytes').notNull().default(0),
  totalBytes: integer('total_bytes').notNull().default(0),
  path: text('path'),
  quality: text('quality').notNull().default('normal'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  /** Pinned items (explicit user downloads) are exempt from LRU cleanup. */
  pinned: integer('pinned').notNull().default(1),
  /** The album/playlist the download was requested from (CarPlay groups by this). */
  groupKind: text('group_kind'),
  groupId: text('group_id'),
  groupName: text('group_name'),
  lastPlayedAt: integer('last_played_at').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const meta = sqliteTable('meta', { key: text('key').primaryKey(), value: text('value').notNull() });
