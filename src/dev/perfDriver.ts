import { log, logWarn } from '../util/log';
import { perfMark, perfOn, setPerfOn, stallTotals } from '../util/perfMode';

type Listener = (text: string) => void;
const typed = new Set<Listener>();
/** Search subscribes to `cmd=type` here. */
export const onPerfType = (fn: Listener): (() => void) => (typed.add(fn), () => void typed.delete(fn));

/**
 * Release-safe TV driver for repeatable runs, only while perf mode is on:
 *   sangeet://perf?on=1|0                    switches the mode (the only link that works when it is off)
 *   sangeet://dev?cmd=nav&a=home|search|library|now|settings
 *   sangeet://dev?cmd=type&a=adele           types a query in Search and submits it
 *   sangeet://dev?cmd=layout&a=music|video|...   sangeet://dev?cmd=play&a=<videoId>
 *   sangeet://dev?cmd=queue&a=q1|q2|q3       plays the first song hit of each query as one queue
 *   sangeet://dev?cmd=mark&a=name            writes `[perf] mark name`
 *   sangeet://dev?cmd=stalls                 writes the stall totals
 * Focus moves are plain D-pad key events (adb shell input keyevent), they cannot be faked from JS.
 */
export function runPerfLink(url: string | null): boolean {
  const m = url && /^sangeet:\/\/(perf|dev)\?(.*)$/.exec(url);
  if (!m) return false;
  const q = new URLSearchParams(m[2]);
  if (m[1] === 'perf') {
    setPerfOn(q.get('on') === '1');
    return true;
  }
  if (!perfOn()) return true;
  const a = q.get('a') ?? '';
  switch (q.get('cmd')) {
    case 'nav':
      void import('../tv/nav').then((n) => n.tvNav().root({ name: a as 'home' }));
      break;
    case 'type':
      typed.forEach((f) => f(a));
      break;
    case 'layout': // a=video|videoLyrics|videoLyricsOverlay|musicLyrics|music|lyrics (changes the remembered layout)
      void import('../tv/playerPrefs').then((n) => {
        console.log(`[perf] layout was ${n.tvLayout()}`);
        if (a) n.setTvLayout(a as never);
      });
      break;
    case 'play': // a=comma list of videoIds
      void import('../player').then((m) => m.playTracks(a.split(',').map((id) => ({ kind: 'track' as const, id, title: id, artists: [{ name: 'perf' }], artwork: [] })), 0, { source: 'perf' }));
      break;
    case 'chain': // a=song search query (b=1: also play it): first song hit -> video chain (tier, requests, ms) and the song/video offset
      void runChainProbe(a, q.get('b') === '1');
      break;
    case 'queue': // a=song queries separated by | : the first song hit of each becomes the queue, then plays (Next timing runs)
      void playQueries(a.split('|'));
      break;
    case 'offset': // a=ms: sets the lyrics sync offset of the current track (the sync control shows once it is not 0)
      void Promise.all([import('../player/store'), import('../lyrics/settings')]).then(([st, ly]) => {
        const t = st.playerState().queue[st.playerState().index];
        if (t) ly.setLyricsOffset(t.id, Number(a) || 0);
      });
      break;
    case 'mark':
      perfMark(a);
      break;
    case 'stalls':
      console.log(`[perf] stalls ${JSON.stringify(stallTotals())}`);
      break;
  }
  return true;
}

async function playQueries(queries: string[]): Promise<void> {
  try {
    const [{ search }, player] = await Promise.all([import('../youtube/api'), import('../player')]);
    const tracks = [];
    for (const q of queries) {
      const hit = (await search(q, 'song')).items.find((i) => i.kind === 'track');
      if (hit && hit.kind === 'track') tracks.push(hit);
    }
    log('perf', `queue of ${tracks.length}: ${tracks.map((t) => t.title).join(' | ')}`);
    if (tracks.length) await player.playTracks(tracks, 0, { source: 'perf' });
  } catch (e) {
    logWarn('perf', 'queue failed', e instanceof Error ? e.message : e);
  }
}

async function runChainProbe(query: string, play: boolean): Promise<void> {
  try {
    const [{ search }, { resolveVideoId }, { ensureOffset }] = await Promise.all([import('../youtube/api'), import('../video/counterpart'), import('../video/offsets')]);
    const hit = (await search(query, 'song')).items.find((i) => i.kind === 'track');
    if (!hit || hit.kind !== 'track') return logWarn('chainprobe', `no song for "${query}"`);
    if (play) void import('../player').then((m) => m.playTracks([hit], 0, { source: 'perf' }));
    const t0 = Date.now();
    const id = await resolveVideoId(hit);
    log('chainprobe', `"${hit.title}" by ${hit.artists[0]?.name}: video ${id ?? 'none'} in ${Date.now() - t0} ms`);
    if (!id) return;
    const t1 = Date.now();
    const off = await ensureOffset(hit, id);
    log('chainprobe', `"${hit.title}": offset ${off ? `${off.offset.toFixed(2)} s via ${off.method}` : 'unknown'} in ${Date.now() - t1} ms`);
  } catch (e) {
    logWarn('chainprobe', e instanceof Error ? e.message : e);
  }
}
