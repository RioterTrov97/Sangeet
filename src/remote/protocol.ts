import type { Track } from '../youtube/models';

/**
 * Sangeet remote protocol: newline-delimited JSON over TCP. The TV is the server, the phone the client.
 * Every message is `{ t: <type>, ...fields }`. `PROTOCOL_VERSION` is bumped on incompatible changes; the TV
 * refuses a `hello` with a different major version.
 */
export const PROTOCOL_VERSION = 1;
/**
 * Compatible additions since 1.0 (every one is an optional field or an extra command that the other side may ignore):
 * 1.1 `layout`; 1.2 song-time fields (`songPosition`, `songDuration`, `seek.song`), the TV-state mirror (`resolvedLayout`,
 * `videoId`, `videoTier`, `videoKind`, `videoState`, `lyrics`, `quality`) and the commands `chooseVideo`, `setLyricsOffset`, `watchVideo`.
 */
export const PROTOCOL_MINOR = 2;
export const DEFAULT_PORT = 8765;
export const SERVICE_TYPE = '_sangeet._tcp';
/** The phone shows a lost-connection banner after this much silence (the TV sends a heartbeat every second). */
export const SILENCE_MS = 5000;

export type WireTrack = {
  videoId: string;
  title: string;
  artist: string;
  artwork: string | null;
  duration: number;
  /** Optional extras so the phone can still navigate to the artist/album of a mirrored track. */
  artists?: { id?: string; name: string }[];
  album?: { id: string; name: string };
  /** A music video / upload rather than a song: the TV plays this id as its own video. */
  isVideo?: boolean;
  videoType?: 'song' | 'official' | 'ugc';
};

export type PlayStatus = 'idle' | 'playing' | 'paused' | 'buffering';
export type RemoteMode = 'audio' | 'video';
/** The TV's Now Playing layout. Older phones only know `RemoteMode`; the TV keeps accepting `setMode`. */
/** `videoLyrics` is the split (70% video / 30% lyrics) layout, `videoLyricsOverlay` the immersive one (full-screen video, lyrics on top at the right). */
export type RemoteLayout = 'video' | 'videoLyrics' | 'videoLyricsOverlay' | 'musicLyrics' | 'music' | 'lyrics';
export const REMOTE_LAYOUTS: readonly RemoteLayout[] = ['video', 'videoLyrics', 'videoLyricsOverlay', 'musicLyrics', 'music', 'lyrics'];
export const isRemoteLayout = (x: unknown): x is RemoteLayout => typeof x === 'string' && (REMOTE_LAYOUTS as readonly string[]).includes(x);
export type RepeatMode = 'off' | 'all' | 'one';

/** Kind of video the TV chose: tier A music video, B lyric video / official audio, C anything else. */
export type WireVideoTier = 'A' | 'B' | 'C';
export type WireVideoKind = 'music' | 'lyric' | 'upload';
export const videoKindOf = (tier: WireVideoTier | undefined): WireVideoKind | undefined => (tier === 'A' ? 'music' : tier === 'B' ? 'lyric' : tier === 'C' ? 'upload' : undefined);
/** `none`: no video is on screen (none exists, or the TV is showing music). */
export type WireVideoState = 'none' | 'loading' | 'playing' | 'failed';
/** The TV's lyrics for the current song. `offsetMs` is the user's own sync offset (positive = lyrics earlier) in song time; `hidden`: synced lyrics withheld for this video. */
export type WireLyrics = { kind: 'synced' | 'plain' | 'none' | 'loading'; offsetMs: number; uncertain: boolean; hidden: boolean };
/** The saved quality settings (ids as in Settings: `max`, `1080`, `high`...). */
export type WireQuality = { video?: string; audio?: string };

export type TvSnapshot = {
  track: WireTrack | null;
  position: number;
  duration: number;
  status: PlayStatus;
  queue: WireTrack[];
  index: number;
  mode: RemoteMode;
  /** Absent when talking to an older TV. */
  layout?: RemoteLayout;
  /** While `mode` is `video`: seconds the video's content is later than the song's (video time = song time + this); absent when unknown or with an older TV. Position and duration are then the video's. */
  videoOffset?: number;
  /** Song time (the track's own timeline), whatever is on the TV screen: in video mode `position` / `duration` are the video's. Absent with an older TV. */
  songPosition?: number;
  songDuration?: number;
  /** What the TV really shows after falling back (no video -> music, no lyrics -> no lyrics panel). */
  resolvedLayout?: RemoteLayout;
  /** The video chosen for the song (null: none; absent: unknown or still looking). */
  videoId?: string | null;
  videoTier?: WireVideoTier;
  videoKind?: WireVideoKind;
  videoState?: WireVideoState;
  lyrics?: WireLyrics;
  quality?: WireQuality;
  shuffle: boolean;
  repeat: RepeatMode;
};

/** phone -> TV */
export type ClientMsg =
  | { t: 'hello'; v: number; deviceId: string; name: string }
  | { t: 'playQueue'; tracks: WireTrack[]; index: number; shuffle?: boolean; position?: number; source?: string; sourceName?: string }
  | { t: 'addToQueue'; track: WireTrack }
  | { t: 'playNext'; track: WireTrack }
  | { t: 'playIndex'; index: number }
  | { t: 'play' }
  | { t: 'pause' }
  | { t: 'next' }
  | { t: 'prev' }
  /** `song: true`: `sec` is song time and the TV maps it to the video's timeline itself. Without it `sec` is the playing timeline's (older phones). */
  | { t: 'seek'; sec: number; song?: boolean }
  | { t: 'setMode'; mode: RemoteMode }
  | { t: 'setLayout'; layout: RemoteLayout }
  | { t: 'setShuffle'; on: boolean }
  | { t: 'setRepeat'; mode: RepeatMode }
  /** Changes the TV's saved audio or video quality and applies it to the current song. `value` is a quality id (`max`, `1080`, `high`...). */
  | { t: 'setQuality'; kind: 'audio' | 'video'; value: string }
  /** Picks the video of a song like the TV's own picker: a video id, `'none'` (no video for it) or null (automatic). `songId` guards against a song change in flight. */
  | { t: 'chooseVideo'; videoId: string | null; songId?: string }
  /** Sets the user's lyrics sync offset (ms, positive = lyrics earlier) for the song. */
  | { t: 'setLyricsOffset'; ms: number; songId?: string }
  /** Shows the song's video on the TV ("Watch video"). */
  | { t: 'watchVideo' }
  | { t: 'like' }
  | { t: 'bye' };

/** TV -> phone */
export type ServerMsg =
  | { t: 'welcome'; v: number; tvId: string; name: string; minor?: number }
  | { t: 'error'; code: 'bad_version' | 'unauthorized' | 'bad_message'; message?: string }
  | ({ t: 'state' } & TvSnapshot)
  /** The TV app was not running: the service woke the device and is starting it; state follows. */
  | { t: 'launching' }
  /** `at` is the TV's send time (Date.now, ms) so the phone can drop out-of-order heartbeats; `position` is already extrapolated to the send moment. */
  | { t: 'tick'; position: number; duration: number; status: PlayStatus; at?: number; songPosition?: number; songDuration?: number };

export type AnyMsg = ClientMsg | ServerMsg;

/** Messages allowed before `hello` has been accepted. Everything else is rejected with `unauthorized`. Home-LAN trust: no pairing. */
export const PRE_AUTH: ReadonlySet<string> = new Set(['hello', 'bye']);

export function encode(msg: AnyMsg): string {
  return `${JSON.stringify(msg)}\n`;
}

/** Parses one line. Returns undefined for anything that is not a JSON object with a string `t`. */
export function decode(line: string): AnyMsg | undefined {
  const s = line.trim();
  if (!s) return undefined;
  try {
    const m = JSON.parse(s) as unknown;
    if (m && typeof m === 'object' && typeof (m as { t?: unknown }).t === 'string') return m as AnyMsg;
  } catch {}
  return undefined;
}

/** Splits a TCP byte stream into lines; keeps the unfinished tail for the next chunk. */
export class LineBuffer {
  private rest = '';
  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split('\n');
    this.rest = parts.pop() ?? '';
    return parts.filter((p) => p.length > 0);
  }
}

export function isAllowed(authed: boolean, type: string): boolean {
  return authed || PRE_AUTH.has(type);
}

export function toWire(t: Track): WireTrack {
  const art = t.artwork.find((a) => a.url.startsWith('http'));
  const w: WireTrack = {
    videoId: t.id,
    title: t.title,
    artist: t.artists.map((a) => a.name).join(', '),
    artwork: art?.url ?? null,
    duration: t.durationSec ?? 0,
  };
  if (t.artists.length) w.artists = t.artists.map((a) => (a.id ? { id: a.id, name: a.name } : { name: a.name }));
  if (t.album) w.album = { id: t.album.id, name: t.album.name };
  if (t.isVideo) w.isVideo = true;
  if (t.videoType) w.videoType = t.videoType;
  return w;
}

export function fromWire(w: WireTrack): Track {
  return {
    kind: 'track',
    id: w.videoId,
    title: w.title,
    artists: w.artists?.length ? w.artists : w.artist ? [{ name: w.artist }] : [],
    album: w.album,
    durationSec: w.duration > 0 ? w.duration : undefined,
    artwork: w.artwork ? [{ url: w.artwork }] : [],
    ...(w.isVideo ? { isVideo: true } : {}),
    ...(w.videoType === 'song' || w.videoType === 'official' || w.videoType === 'ugc' ? { videoType: w.videoType } : {}),
  };
}

export function isWireTrack(x: unknown): x is WireTrack {
  const w = x as WireTrack | null;
  return !!w && typeof w === 'object' && typeof w.videoId === 'string' && w.videoId.length > 0 && typeof w.title === 'string';
}

/** "Connect by IP" input: "192.168.1.20" or "192.168.1.20:8765". */
export function parseAddress(input: string): string | undefined {
  const m = /^\s*([A-Za-z0-9.-]+)(?::(\d{1,5}))?\s*$/.exec(input);
  if (!m) return undefined;
  const port = m[2] ? Number(m[2]) : DEFAULT_PORT;
  return port > 0 && port < 65536 ? `${m[1]}:${port}` : undefined;
}

