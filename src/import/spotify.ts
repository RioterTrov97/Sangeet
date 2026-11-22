export type SpotifyRef = { kind: 'playlist' | 'album'; id: string };
export type SpotifyTrack = { title: string; artists: string[]; durationMs?: number };
export type SpotifyList = { kind: SpotifyRef['kind']; id: string; name: string; cover?: string; tracks: SpotifyTrack[] };

/** Reads a public open.spotify.com link (or a spotify: URI) for a playlist or album. */
export function parseSpotifyLink(text: string): SpotifyRef | undefined {
  const t = text.trim();
  const url = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album)\/([A-Za-z0-9]{10,32})/.exec(t);
  if (url) return { kind: url[1] as SpotifyRef['kind'], id: url[2] };
  const uri = /^spotify:(playlist|album):([A-Za-z0-9]{10,32})$/.exec(t);
  return uri ? { kind: uri[1] as SpotifyRef['kind'], id: uri[2] } : undefined;
}

export class SpotifyError extends Error {
  constructor(readonly code: 'private' | 'network' | 'format', message: string) {
    super(message);
  }
}

const embedUrl = (r: SpotifyRef) => `https://open.spotify.com/embed/${r.kind}/${r.id}`;

/** Pulls name, cover and tracks out of the embed page's __NEXT_DATA__ JSON. Pure: no network. */
export function parseEmbedHtml(html: string, ref: SpotifyRef): SpotifyList {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new SpotifyError('format', 'Could not read this Spotify page');
  let entity: any;
  try {
    entity = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
  } catch {
    throw new SpotifyError('format', 'Could not read this Spotify page');
  }
  if (!entity || !Array.isArray(entity.trackList)) throw new SpotifyError('private', 'This playlist is private or was not found');
  const tracks: SpotifyTrack[] = [];
  for (const t of entity.trackList) {
    if (!t?.title) continue;
    const artists = String(t.subtitle ?? '')
      .split(/,\s*|, /)
      .map((a) => a.replace(/ /g, ' ').trim())
      .filter(Boolean);
    tracks.push({ title: String(t.title), artists, durationMs: typeof t.duration === 'number' ? t.duration : undefined });
  }
  const sources = entity.coverArt?.sources;
  const cover = Array.isArray(sources) && sources.length ? String(sources[sources.length - 1].url) : undefined;
  return { kind: ref.kind, id: ref.id, name: String(entity.name ?? entity.title ?? 'Spotify playlist'), cover, tracks };
}

/** Fetches the public embed page (no login, no cookies). The embed lists up to the first 100 tracks. */
export async function fetchSpotifyList(ref: SpotifyRef, signal?: AbortSignal): Promise<SpotifyList> {
  let res: Response;
  try {
    res = await fetch(embedUrl(ref), { signal, headers: { 'Accept-Language': 'en' } });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new SpotifyError('network', 'Could not reach Spotify. Check your connection');
  }
  if (res.status === 404) throw new SpotifyError('private', 'This playlist is private or was not found');
  if (!res.ok) throw new SpotifyError('network', `Spotify answered ${res.status}`);
  return parseEmbedHtml(await res.text(), ref);
}
