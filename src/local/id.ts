/**
 * Songs from this iPhone are ordinary queue tracks whose id is `local-` + a hash of the file's path inside Documents/Music.
 * YouTube video ids are 11 characters from [A-Za-z0-9_-] and never start with `local-`, and the id has no `:` (the stream
 * proxy treats ids containing one specially). Everything that talks to YouTube (stream resolve, likes sync, video, radio, links)
 * asks `isLocalId` first.
 */
export const LOCAL_PREFIX = 'local-';

export const isLocalId = (id: string | null | undefined): boolean => !!id && id.startsWith(LOCAL_PREFIX);

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

/** FNV-1a 64-bit over the UTF-16 code units of `s`, as 16 hex digits. */
export function fnv1a64(s: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) h = BigInt.asUintN(64, (h ^ BigInt(s.charCodeAt(i))) * FNV_PRIME);
  return h.toString(16).padStart(16, '0');
}

/**
 * The id of the song at `rel` (path relative to Documents/Music, `/` separated). Stable across launches and reinstalls, so likes,
 * playlists and history keep pointing at the same file. NFC-normalised because Finder and Files can hand out the same name in
 * either Unicode form.
 */
export const localIdFor = (rel: string): string => LOCAL_PREFIX + fnv1a64(rel.normalize('NFC'));
