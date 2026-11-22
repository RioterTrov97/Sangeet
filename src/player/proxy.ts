import { Platform } from 'react-native';

import StreamProxy from '../../modules/stream-proxy';
import { isLocalId } from '../local/id';
import { log, logWarn } from '../util/log';
import { startExtractorHost } from '../youtube/extractor/nativeHost';
import { ChainResolver, ResolveError } from '../youtube/resolver/ChainResolver';
import { noteFailure } from '../youtube/resolver/lastFailure';
import { OnDeviceResolver } from '../youtube/resolver/OnDeviceResolver';
import { PersonalServerResolver } from '../youtube/resolver/PersonalServerResolver';
import { serverConfig, serverConfigured } from '../youtube/resolver/serverConfig';
import type { ResolvedStream } from '../youtube/resolver/types';

/**
 * Plain progressive-file path (`/v/<id>`) instead of the byte-range HLS playlist (`/v/<id>.m3u8`).
 * HLS gives startup independent of track length and exact durations; keep this flag as the fallback.
 */
export const USE_HLS = Platform.OS === 'ios'; // Android (ExoPlayer) plays the progressive /v/<id> directly

/** OnDevice (per-client circuit breakers) -> personal backup server (if configured) -> fail. */
const device = new OnDeviceResolver();
export const resolver = new ChainResolver({
  device,
  server: new PersonalServerResolver(),
  serverConfigured,
  serverOnly: () => serverConfig().forceServerOnly,
});

// MWEB / WEB_EMBEDDED URLs are checked past 1 MiB in the background after playback began; a failure excludes that client for the
// video and primes the proxy with another client's URL (the proxy's own 403 re-resolve and the queue's recovery continue from there).
device.onLateReject = (videoId, client) => {
  resolver.exclusions.exclude(videoId, client);
  void refreshStream(videoId).catch(() => {});
};

/** Keeps the typed reason of a failed resolve for the notice the queue shows when the track then fails to play. */
function noteResolveFailure(videoId: string, e: unknown): void {
  if (e instanceof ResolveError) noteFailure(videoId, e.playability, e.retryInMs);
}

/** Clients that served the current URL of a stream (refresh rotates away from them). */
const served = new Map<string, string[]>();
let startPromise: Promise<number> | undefined;
let currentPort = 0;

function toNative(s: ResolvedStream) {
  return {
    url: s.url,
    mimeType: s.mimeType,
    contentLength: s.contentLength,
    expiresAt: s.expiresAt,
    userAgent: s.userAgent,
    headers: s.headers,
    initStart: s.initRange?.start,
    initEnd: s.initRange?.end,
    indexStart: s.indexRange?.start,
    indexEnd: s.indexRange?.end,
    codecs: s.codecs,
    width: s.width,
    height: s.height,
    bitrate: s.bitrate,
    durationMs: s.durationMs,
  };
}

/** Starts the proxy and wires the lazy-resolve bridge exactly once. Resolves with the port. */
export function startProxy(): Promise<number> {
  startPromise ??= (async () => {
    startExtractorHost();
    StreamProxy.addListener('onResolveRequest', ({ videoId, requestId, refresh }) => {
      const t0 = Date.now();
      if (isLocalId(videoId)) return StreamProxy.reject(requestId, 'local song: not a YouTube video');
      // A refresh means the URL we served 403'd: put the client that produced it behind the others for this stream.
      const avoid = refresh ? (served.get(videoId) ?? []) : [];
      resolver
        .resolve(videoId, { fresh: refresh, avoid })
        .then((s) => {
          served.set(videoId, [...avoid, ...(s.client ? [s.client] : [])]);
          if (served.size > 50) served.delete(served.keys().next().value as string);
          log('proxy', `resolved ${videoId}${refresh ? ' (refresh)' : ''} in ${Date.now() - t0}ms`);
          StreamProxy.fulfill(requestId, videoId, toNative(s));
        })
        .catch((e) => {
          noteResolveFailure(videoId, e);
          logWarn('proxy', `resolve ${videoId} failed`, e instanceof Error ? e.message : e);
          StreamProxy.reject(requestId, e instanceof Error ? e.message : String(e));
        });
    });
    currentPort = await StreamProxy.start();
    log('proxy', `listening on 127.0.0.1:${currentPort}`);
    return currentPort;
  })();
  return startPromise;
}

/** True when something answers on the proxy port (any HTTP status counts; a refused connection or 1.5 s of silence does not). */
async function proxyAnswers(port: number): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    await fetch(`http://127.0.0.1:${port}/ping`, { signal: ctl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

let checking: Promise<void> | undefined;
/**
 * Makes sure the proxy still answers before playback resumes. While the app sits paused in the background iOS can take
 * the listening socket away without the listener reporting it; every song (saved ones too, which are served from the
 * proxy's cache) then fails to load. A dead proxy is rebound on the same port, so URLs the player already holds stay valid.
 */
export function ensureProxyAlive(): Promise<void> {
  if (!currentPort) return Promise.resolve();
  checking ??= (async () => {
    if (await proxyAnswers(currentPort)) return;
    logWarn('proxy', `not answering on ${currentPort}; restarting it`);
    try {
      currentPort = await (StreamProxy.restart ? StreamProxy.restart() : StreamProxy.start());
      log('proxy', `listening again on 127.0.0.1:${currentPort}`);
    } catch (e) {
      logWarn('proxy', 'restart failed', e instanceof Error ? e.message : e);
    }
  })().finally(() => (checking = undefined));
  return checking;
}

/** Forces a fresh upstream URL for `videoId` (the current one failed mid-song): resolves again, rotating away from the client that served it. */
export async function refreshStream(videoId: string): Promise<void> {
  if (isLocalId(videoId)) return; // a file on this device: nothing to resolve
  const avoid = served.get(videoId) ?? [];
  const s = await resolver.resolve(videoId, { fresh: true, avoid });
  served.set(videoId, [...avoid, ...(s.client ? [s.client] : [])]);
  StreamProxy.fulfill(null, videoId, toNative(s));
}

/** Stable per-track URL. The stream behind it is resolved on first request. */
export function trackUrl(videoId: string): string {
  if (!currentPort) throw new Error('proxy not started');
  return `http://127.0.0.1:${currentPort}/v/${videoId}${USE_HLS ? '.m3u8' : ''}`;
}

/** The audio stream as a plain progressive fragmented-mp4 file on both platforms (range requests; used to read frame sizes for the song/video offset). */
export function audioFileUrl(videoId: string): string {
  if (!currentPort) throw new Error('proxy not started');
  return `http://127.0.0.1:${currentPort}/v/${videoId}`;
}

/**
 * Video-mode URLs. iOS: combined HLS master (adaptive avc1 + audio group). Android: a local DASH manifest merging the
 * adaptive video-only stream and the audio stream (both through this proxy). `muxed` is the itag-18 fallback.
 */
export function videoUrl(videoId: string, kind: 'hls' | 'muxed'): string {
  if (!currentPort) throw new Error('proxy not started');
  if (kind === 'muxed') return `http://127.0.0.1:${currentPort}/vx/${videoId}.mp4`;
  return Platform.OS === 'ios' ? `http://127.0.0.1:${currentPort}/vm/${videoId}.m3u8` : `http://127.0.0.1:${currentPort}/vd/${videoId}.mpd`;
}

const MAX_PREFETCH = 2;
const prefetching = new Set<string>();
let skipPrefetch: ((videoId: string) => boolean) | undefined;
/** Lets the queue veto prefetching (downloaded tracks play from disk; offline there is nothing to resolve). */
export const setPrefetchFilter = (fn: (videoId: string) => boolean) => void (skipPrefetch = fn);

/** Resolves a track in the background and primes the proxy so its first request needs no JS round trip. */
export function prefetch(videoId: string): void {
  if (isLocalId(videoId) || prefetching.has(videoId) || skipPrefetch?.(videoId)) return;
  if (prefetching.size >= MAX_PREFETCH) return; // never resolve a whole upcoming queue at once
  prefetching.add(videoId);
  resolver
    .resolve(videoId)
    .then((s) => {
      StreamProxy.fulfill(null, videoId, toNative(s));
      log('proxy', `prefetched ${videoId}`);
    })
    .catch((e) => {
      noteResolveFailure(videoId, e);
      logWarn('proxy', `prefetch ${videoId} failed`, e instanceof Error ? e.message : e);
    })
    .finally(() => prefetching.delete(videoId));
}

const prefetchingVideo = new Set<string>();
/**
 * Video mode: resolves the video-only stream (key `v:<id>`) and the video's own audio of the NEXT song's video in the
 * background and primes the proxy, so Next only has to load the (already known) manifest.
 */
export function prefetchVideoStreams(videoId: string): void {
  if (isLocalId(videoId) || prefetchingVideo.has(videoId)) return;
  prefetchingVideo.add(videoId);
  const key = `v:${videoId}`;
  resolver
    .resolve(key)
    .then((s) => {
      StreamProxy.fulfill(null, key, toNative(s));
      log('proxy', `prefetched video ${videoId}`);
    })
    .catch((e) => logWarn('proxy', `video prefetch ${videoId} failed`, e instanceof Error ? e.message : e))
    .finally(() => setTimeout(() => prefetchingVideo.delete(videoId), 60_000)); // not again within a minute (the resolver caches the result)
  prefetch(videoId); // its audio group
}
