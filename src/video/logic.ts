/** Pure helpers for the Song/Video switch, kept separate so they're unit-testable. */

/** Position to resume at after a switch: finite, >= 0 and not past the end (leave a little room so it doesn't instantly end). */
export function switchPosition(position: number, duration?: number): number {
  if (!Number.isFinite(position) || position < 0) return 0;
  if (duration && duration > 1 && position > duration - 0.5) return Math.max(0, duration - 0.5);
  return position;
}

export type NextAction = { kind: 'video'; videoId: string } | { kind: 'song' };

/** After a queue advance in video mode: stay in video if the new track has a video, otherwise fall back to the song. */
export function nextModeAfterAdvance(videoId: string | null | undefined): NextAction {
  return videoId ? { kind: 'video', videoId } : { kind: 'song' };
}

/** True when the track that just ended must play again in place: repeat-one, or repeat-all over a one-song queue (a skip would land on the same item and the native player reports no track change). */
export const loopsInPlace = (repeat: 'off' | 'all' | 'one', queueLength: number): boolean => repeat === 'one' || (repeat === 'all' && queueLength <= 1);

/** The id to play as video for a track: itself when it is a video (or the artist's own music video), else its counterpart (or none). */
export function videoIdFor(track: { id: string; isVideo?: boolean; videoType?: string }, counterpart: string | null | undefined): string | null {
  return track.isVideo || track.videoType === 'official' ? track.id : (counterpart ?? null);
}

/** Position-sync guard: while the video is seeking/buffering its reported time can lag; only accept forward jumps < 5 s or explicit seeks. */
export function shouldAcceptVideoTime(prev: number, next: number, seeking: boolean): boolean {
  if (!Number.isFinite(next) || next < 0) return false;
  return seeking || Math.abs(next - prev) < 5 || next > prev;
}

type Cand = { id: string; title: string; artists: { name: string }[]; durationSec?: number; videoType?: string; views?: number };

/** Upload words that mean "not the real recording" (unless the song title itself has them). */
export const NOT_ORIGINAL = /\b(live|cover|covered|karaoke|reaction|remix|slowed|sped|reverb|instrumental|8d|nightcore|lyrics?|tribute|acoustic|amv|gmv|fan ?made|edit|mashup|piano|guitar|violin|bass ?boosted|1 ?hour|loop|tutorial|parody)\b/;

const compact = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** True when the uploading channel is the artist (exact name, "<Artist>VEVO", "<Artist> - Topic", "<Artist> Official"). */
export function channelIsArtist(channels: { name: string }[], artist: string, normArtist: (s: string) => string): boolean {
  const want = compact(normArtist(artist));
  if (!want) return false;
  return channels.some((c) => {
    const got = compact(normArtist(c.name));
    return got === want || (got.startsWith(want) && /^(vevo|topic|official|music|officialmusic|tv|channel)?$/.test(got.slice(want.length)));
  });
}

/**
 * Song -> music video match from "Videos" search results. The artist's own uploads (channel is the artist or its
 * VEVO/Topic channel) always win, then other official uploads (label channels). User uploads (YouTube's UGC label) are
 * a last resort when nothing official matches (the most viewed strict match wins), and must name the artist in their title.
 * The candidate title must contain the song title, the duration must be within -8 s .. +90 s of the song (videos often
 * add an intro), and covers/AMVs/lyric/live uploads are rejected. YouTube's "official music video" label wins, then
 * "Official" in the title, then the closest duration. Returns null rather than guessing.
 */
export function pickVideoMatch(song: Cand, candidates: Cand[], normTitle: (s: string) => string, normArtist: (s: string) => string): string | null {
  const title = normTitle(song.title).toLowerCase();
  const artist = song.artists[0]?.name ?? '';
  if (!title || !normArtist(artist)) return null;
  const songHasBadWord = NOT_ORIGINAL.test(song.title.toLowerCase());
  const scored = candidates
    // The song's own id is a valid match when the track is itself a video (radio items carry no label); only a known audio-only song rules itself out.
    .filter((c) => (c.id !== song.id || song.videoType !== 'song') && c.videoType !== 'song')
    .map((c) => {
      const raw = c.title.toLowerCase();
      const own = channelIsArtist(c.artists, artist, normArtist);
      // Someone else's upload only counts when it names the artist, and it sorts below every official candidate.
      const okArtist = own || raw.includes(normArtist(artist).toLowerCase());
      const okTitle = normTitle(c.title).toLowerCase().includes(title);
      const d = c.durationSec != null && song.durationSec != null ? c.durationSec - song.durationSec : 0;
      const okDur = d >= -8 && d <= 90;
      const bad = !songHasBadWord && NOT_ORIGINAL.test(raw.replace(title, ''));
      const rank = (c.videoType === 'official' ? 2 : 0) + (/official/.test(raw) ? 1 : 0);
      return { c, ok: okArtist && okTitle && okDur && !bad, own, upload: c.videoType === 'ugc' && !own, rank, d: Math.abs(d), views: c.views ?? 0 };
    })
    .filter((x) => x.ok);
  const official = scored.filter((x) => !x.upload).sort((a, b) => Number(b.own) - Number(a.own) || b.rank - a.rank || a.d - b.d);
  if (official[0]) return official[0].c.id;
  // No official video: among the strictly matching user uploads take the most viewed (ties: "official" in the title, then closest length).
  const uploads = scored.sort((a, b) => b.views - a.views || b.rank - a.rank || a.d - b.d);
  return uploads[0]?.c.id ?? null;
}

/**
 * Radio / up-next filter: drops other people's uploads that are covers, instrumentals, fan edits etc., so autoplay stays
 * on real recordings. Keeps everything when the seed itself is that kind of track (someone listening to piano covers).
 */
export function radioFilter<T extends Cand>(list: T[], seed?: Cand): T[] {
  const kept = list.filter((t) => isOriginalRecording(t, seed));
  const official = kept.filter((t) => t.videoType !== 'ugc');
  return official.some((t) => t.videoType) ? official : kept;
}

export function isOriginalRecording(t: Cand, seed?: Cand): boolean {
  const raw = t.title.toLowerCase();
  if (seed && NOT_ORIGINAL.test(seed.title.toLowerCase())) return true;
  if (NOT_ORIGINAL.test(raw) && t.videoType !== 'song') return false;
  return true;
}

// ---- make-before-break handover between the audio player and the video player ----

/** Give up on a video that is not playing (muted, in sync) after this long; the song just keeps playing. */
export const ENTER_TIMEOUT_MS = 8000;
/** Leaving video: wait this long for the audio player to report playing before handing over anyway. */
export const EXIT_TIMEOUT_MS = 4000;
/** Drift between the two players above which the incoming one is re-seeked before the cut. */
export const SYNC_TOLERANCE_S = 0.3;
/** Seeking costs a little time to buffer: aim this far ahead of the live position. */
export const SEEK_LEAD_S = 0.25;
export const FADE_MS = 200;
export const FADE_STEPS = 5;

export type SyncPlan = { seek: false } | { seek: true; to: number };

/** Where the incoming player stands against the one that is audible: fine, or seek it to the live position plus a lead. */
export function syncPlan(incoming: number, live: number, tolerance = SYNC_TOLERANCE_S, lead = SEEK_LEAD_S): SyncPlan {
  if (!Number.isFinite(incoming) || !Number.isFinite(live)) return { seek: false };
  return Math.abs(incoming - live) > tolerance ? { seek: true, to: Math.max(0, live + lead) } : { seek: false };
}

/** Gains for step `i` of `n` (1..n) of a crossfade: `out` falls 1 -> 0, `in` rises 0 -> 1 (equal-power so the sum stays level). */
export function fadeGains(i: number, n: number): { out: number; in: number } {
  const t = Math.min(1, Math.max(0, i / n));
  return { out: Math.cos((t * Math.PI) / 2), in: Math.sin((t * Math.PI) / 2) };
}

export const handoverExpired = (startedAt: number, now: number, limitMs: number): boolean => now - startedAt >= limitMs;

/** True when the audio player has really started: it reports playing and its position has moved on from where we started it. */
export function audioHasStarted(state: string, position: number, startedAt: number): boolean {
  return state === 'playing' && position > startedAt + 0.05;
}
