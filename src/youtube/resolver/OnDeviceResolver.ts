import { log, logWarn, timed } from '../../util/log';
import { perfFirstStream } from './firstStream';
import { extractorBridge, type ExtractorBridge } from '../extractor/bridge';
import type { StreamInfo } from '../extractor/protocol';
import StreamProxy from '../../../modules/stream-proxy';
import { describeAudio } from '../formats';
import { noteHighQuality } from './quality';
import { currentQuality, decoderCaps, osName } from './qualitySettings';
import { useStreamInfo } from './streamInfo';
import { StreamCache } from './cache';
import type { ResolvedStream, StreamResolver } from './types';

/**
 * Verifies the URL serves bytes by fetching only its first two bytes (`Range: bytes=0-1`). Native fetch: no CORS involved.
 * Do NOT probe the last byte: some googlevideo edges (seen on a NZ edge, rr1---sn-hufvjvgx-ntqz) answer a tail range with an
 * empty 403 even though the URL, PoToken, signature and `n` are all valid and `bytes=0-1` returns 206.
 */
export async function validate(s: ResolvedStream): Promise<void> {
  await probeBytes(s, 0, '');
}

async function probeBytes(s: ResolvedStream, from: number, label: string): Promise<void> {
  const res = await fetch(s.url, {
    headers: { Range: `bytes=${from}-${from + 1}`, ...(s.userAgent ? { 'User-Agent': s.userAgent } : {}) },
  });
  if (res.status !== 206 && res.status !== 200) throw new Error(`validation HTTP ${res.status}${label}`);
  const len = (await res.arrayBuffer()).byteLength;
  if (len < 1) throw new Error(`validation returned no bytes${label}`);
}

const PAST_FIRST_MIB = 1_310_720;
/** Clients known to serve the whole file (no 1 MiB cutoff): never probed. */
export const NO_CUTOFF_CLIENTS: ReadonlySet<string> = new Set(['VISIONOS', 'TV']);

/**
 * Some clients' URLs (measured: IOS) serve the first 1 MiB and answer 403 for every later byte, which cuts a song at ~64 s.
 * This probes just past that mark (not the tail, see above). It is NOT on the start path: it runs in the background after
 * playback began, and a failure re-resolves with the next client (see onLateReject) while the recovery path resumes playback.
 */
export async function validateDeep(s: ResolvedStream): Promise<void> {
  if (s.client && NO_CUTOFF_CLIENTS.has(s.client)) return;
  if (s.contentLength > PAST_FIRST_MIB + 4096) await probeBytes(s, PAST_FIRST_MIB, ' past 1 MiB');
}

function readCaps() {
  try {
    return (StreamProxy as { decoderCaps?: () => import('../formats').DecoderCaps }).decoderCaps?.();
  } catch {
    return undefined;
  }
}

export class OnDeviceResolver implements StreamResolver {
  private cache = new StreamCache();
  private inflight = new Map<string, Promise<ResolvedStream>>();

  constructor(
    private readonly bridge: ExtractorBridge = extractorBridge,
    private readonly validateFn: (s: ResolvedStream) => Promise<void> = validate,
    private readonly deepFn: (s: ResolvedStream) => Promise<void> = validateDeep,
    /** Called when the background past-1-MiB check fails for a stream that already started playing. */
    public onLateReject?: (videoId: string, client: string, message: string) => void,
  ) {}

  resolve(videoId: string, opts?: { fresh?: boolean; clients?: string[]; lowQuality?: boolean }): Promise<ResolvedStream> {
    // Streams are cached per quality setting: changing it applies from the next resolve, never to a track already playing.
    const q = currentQuality();
    videoId = `${videoId}${/^[vm]:/.test(videoId) ? `#${q.video}` : `#${q.audio}`}`;
    if (opts?.fresh) {
      this.cache.delete(videoId);
      this.inflight.delete(videoId); // a fresh resolve starts its own run; an older, slower one can no longer overwrite it (generations)
    }
    const cached = this.cache.get(videoId);
    if (cached) {
      log('resolver', `cache hit ${videoId}`);
      return Promise.resolve(cached);
    }
    let p = this.inflight.get(videoId);
    if (!p) {
      const gen = this.cache.begin(videoId);
      const run: Promise<ResolvedStream> = this.doResolve(videoId, opts?.clients, opts?.lowQuality, gen).finally(() => {
        if (this.inflight.get(videoId) === run) this.inflight.delete(videoId);
      });
      p = run;
      this.inflight.set(videoId, run);
    }
    return p;
  }

  private async doResolve(videoId: string, clients?: string[], lowQuality?: boolean, gen?: number): Promise<ResolvedStream> {
    const start = Date.now();
    await timed('resolver', 'extractor ready', () => this.bridge.whenReady());
    // Keys `v:<id>` (adaptive video) and `m:<id>` (muxed itag 18) resolve video formats; plain ids resolve audio.
    const [bare] = videoId.split('#');
    const video = /^([vm]):(.+)$/.exec(bare);
    const q = lowQuality ? { audio: 'saver' as const, video: '360' as const } : currentQuality();
    const os = osName();
    let remaining = clients;
    const rejected: { client: string; error?: string }[] = [];
    let stream!: ResolvedStream;
    let info!: StreamInfo;
    for (;;) {
      info = await timed('resolver', `extract ${bare}`, () =>
        video
          ? this.bridge.request<StreamInfo>('getVideoStream', { videoId: video[2], kind: video[1] === 'm' ? 'muxed' : 'adaptive', clients: remaining, video: q.video, os, caps: os === 'android' ? decoderCaps(readCaps) : undefined }, 60_000)
          : this.bridge.request<StreamInfo>('getStream', { videoId: bare, clients: remaining, audio: q.audio, os }, 60_000),
      );
      log('resolver', `client=${info.client} itag=${info.itag} len=${info.contentLength} steps=${JSON.stringify(info.timings)}`);
      stream = { ...info, source: 'device', failed: [...rejected, ...(info.failed ?? [])] };
      try {
        await timed('resolver', 'validate', () => this.validateFn(stream));
        break;
      } catch (e) {
        // A client whose URL does not serve the whole file (403 at start or past 1 MiB) is dropped; the next one is tried.
        const msg = e instanceof Error ? e.message : String(e);
        const next = remaining && info.client ? remaining.filter((c) => c !== info.client) : [];
        if (!info.client || !remaining || next.length === 0) {
          if (rejected.length) throw new Error(`ATTEMPTS ${video ? 'video' : 'audio'} ${JSON.stringify([...rejected, { client: info.client ?? '?', error: msg }])}`);
          throw e;
        }
        rejected.push({ client: info.client, error: msg });
        log('resolver', `client ${info.client} rejected by validation (${msg}); trying ${next.join(',')}`);
        remaining = next;
      }
    }
    if (info.hasHigh) noteHighQuality();
    if (!video) useStreamInfo.getState().set(bare, `${describeAudio({ itag: info.itag, mime_type: info.mimeType, bitrate: info.bitrate })} (itag ${info.itag})`);
    else log('resolver', `video ${bare} itag ${info.itag} ${info.codecs} ${info.width}x${info.height} ${info.bitrate}bps (setting ${q.video})`);
    if (!this.cache.set(videoId, stream, gen)) log('resolver', `${videoId}: a newer resolve is in charge; this result is not cached`);
    // Off the start path: the deep check runs after we return.
    if (stream.client && !NO_CUTOFF_CLIENTS.has(stream.client) && !video) {
      void this.deepFn(stream).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        logWarn('resolver', `${bare} ${stream.client} fails past 1 MiB (${msg}); switching client in the background`);
        this.cache.delete(videoId);
        this.onLateReject?.(bare, stream.client!, msg);
      });
    }
    log('resolver', `resolved ${videoId} in ${Date.now() - start}ms`);
    perfFirstStream(Date.now() - start);
    return stream;
  }
}
