import { downloadedTracks } from '../downloads/manager';
import { libraryState, useLibraryStore } from '../library/store';
import { logWarn } from '../util/log';
import SiriMedia from '../../modules/siri-media';

const MAX = 100; // INVocabulary limit per type

function names(): { playlists: string[]; artists: string[] } {
  const lib = libraryState();
  const playlists = [...lib.playlists.map((p) => p.name), ...lib.saved.filter((s) => s.kind === 'playlist').map((s) => (s as { title: string }).title)];
  const counts = new Map<string, number>();
  for (const t of [...lib.liked, ...downloadedTracks()]) for (const a of t.artists) counts.set(a.name, (counts.get(a.name) ?? 0) + 1);
  const artists = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  return { playlists: [...new Set(playlists)].slice(0, MAX), artists: artists.slice(0, MAX) };
}

let last = '';
export function syncVocabulary(): void {
  const v = names();
  const key = JSON.stringify(v);
  if (key === last) return;
  last = key;
  try {
    SiriMedia.setVocabulary(v.playlists, v.artists);
  } catch (e) {
    logWarn('siri', 'vocabulary failed', e instanceof Error ? e.message : e);
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Re-donates the vocabulary (debounced) whenever playlists, saved items or likes change. */
export function startVocabularySync(): void {
  syncVocabulary();
  useLibraryStore.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(syncVocabulary, 3000);
  });
}
