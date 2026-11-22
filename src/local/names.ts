/** Pure file-name helpers for songs from this iPhone (no file system access, so they are unit-tested). */

/** mp3, m4a (also alac), aac, mp4 (audio), wav, aif/aiff, flac, caf. */
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'mp4', 'wav', 'aif', 'aiff', 'flac', 'caf', 'alac'] as const;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Dot files (".DS_Store", AppleDouble "._song.mp3", the hidden artwork folder) are never songs. */
export const isHiddenName = (name: string): boolean => name.startsWith('.');

export const isAudioFileName = (name: string): boolean => !isHiddenName(name) && (AUDIO_EXTENSIONS as readonly string[]).includes(extensionOf(name));

export const stripExtension = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

/**
 * Title and artist from a file name, for files whose tags are empty: "Artist - Title.mp3". A leading track number
 * ("01 - ", "07. ") is dropped. With no " - " the whole name is the title.
 */
export function parseFileName(fileName: string): { title: string; artist?: string } {
  const base = stripExtension(fileName).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const noNumber = base.replace(/^\d{1,3}\s*[-._)]\s*(?=\S)/, '');
  const text = noNumber || base;
  const at = text.indexOf(' - ');
  if (at > 0) {
    const artist = text.slice(0, at).trim();
    const title = text.slice(at + 3).trim();
    if (artist && title) return { title, artist };
  }
  return { title: text };
}

export type FileTags = { title?: string; artist?: string; album?: string; durationSec?: number };
export const UNKNOWN_ARTIST = 'Unknown artist';

/** Tags first, then the file name, then "Unknown artist". */
export function resolveMeta(tags: FileTags, fileName: string): { title: string; artists: string[]; album?: string; durationSec?: number } {
  const parsed = parseFileName(fileName);
  const title = tags.title?.trim() || parsed.title || stripExtension(fileName);
  const artist = tags.artist?.trim() || parsed.artist || UNKNOWN_ARTIST;
  const album = tags.album?.trim() || undefined;
  const durationSec = tags.durationSec && tags.durationSec > 0 ? Math.round(tags.durationSec) : undefined;
  return { title, artists: [artist], album, durationSec };
}

/**
 * The name a picked file gets inside the music folder: its own name, or "Name (2).ext", "Name (3).ext" when `taken` already has
 * it. The comparison ignores case because the iOS file system does. The caller adds the result to `taken`.
 */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * The container path changes when the app is updated or reinstalled, so a `file://` artwork url saved in the library or the
 * queue goes stale. Points one of ours (a file inside the hidden art folder) at the current art folder; anything else is returned as is.
 */
export function rebaseArtUri(url: string, artDirUri: string): string {
  if (!url.startsWith('file://')) return url;
  const m = /\/\.music-art\/([^/?#]+)$/.exec(url);
  if (!m) return url;
  return `${artDirUri.replace(/\/+$/, '')}/${m[1]}`;
}

/**
 * `file://` uri of `rel` (slash-separated, raw names) inside the directory `dirUri`, every name fully percent-encoded.
 * expo-file-system's own joining encodes spaces but leaves "[" and "]" raw (yt-dlp names end in "[videoId]"); iOS then rejects
 * the uri and re-encodes all of it, so "%20" lands in the real file name and the song is written or looked up at the wrong path.
 */
export function fileUriIn(dirUri: string, rel: string): string {
  return `${dirUri.replace(/\/+$/, '')}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}
