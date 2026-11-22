import { apiHigh, getSession } from '../../youtube/api';
import { isLocalId } from '../../local/id';
import { log } from '../../util/log';
import type { LyricsProvider } from '../types';
import { ANDROID_MUSIC, androidBrowseBody, lyricsBrowseId, parseTimedLyrics } from './ytTimed';

/** Timed lines from the Android music client's lyrics tab; undefined when it has none or the request fails. */
async function timedLines(videoId: string, yt: any) {
  const next: any = await yt.actions.execute('/next', { videoId, client: 'YTMUSIC' });
  const browseId = lyricsBrowseId(next.data);
  if (!browseId) return undefined;
  const res = await fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': ANDROID_MUSIC.ua, 'x-youtube-client-name': '21', 'x-youtube-client-version': ANDROID_MUSIC.version, origin: 'https://music.youtube.com' },
    body: JSON.stringify(androidBrowseBody(browseId)),
  });
  if (!res.ok) throw new Error(`browse ${res.status}`);
  const text = await res.text();
  const lines = parseTimedLyrics(JSON.parse(text));
  if (!lines) throw new Error('no timed lines (the lyrics have no cue times)');
  return lines;
}

/** YouTube Music's own lyrics: timed lines from the Android client when it has them, otherwise the web client's plain text. */
export const ytmusic: LyricsProvider = {
  id: 'ytmusic',
  label: 'YouTube Music',
  getLyrics: (track) => (isLocalId(track.id) ? Promise.resolve(null) : apiHigh(() => fetchYt(track.id))), // it looks the song up by its YouTube id
};

async function fetchYt(id: string) {
  const yt: any = await getSession();
  try {
    const synced = await timedLines(id, yt);
    if (synced) return { synced };
  } catch (e) {
    log('lyrics', `no timed lyrics for ${id}: ${e instanceof Error ? e.message : e}`); // then plain text
  }
  const res: any = await yt.music.getLyrics(id);
  if (!res) return null;
  const plain = res.description?.toString?.() ?? res.description?.text ?? '';
  return plain.trim() ? { plain: plain.trim() } : null;
}
