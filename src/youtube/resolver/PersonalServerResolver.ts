import { log } from '../../util/log';
import { StreamCache } from './cache';
import { serverConfig } from './serverConfig';
import type { ResolvedStream, StreamResolver } from './types';

type ServerResolve = { url: string; mimeType: string; contentLength: number; expiresAt: number; itag: number; initRange?: { start: number; end: number }; indexRange?: { start: number; end: number } };

/**
 * Resolves through the user's backup server. The returned `url` is the server's own `/stream/<id>` endpoint (it proxies
 * the bytes because googlevideo URLs are usually bound to the requester's IP), so our local proxy keeps doing the HLS
 * and mdhd handling and only adds the bearer token.
 */
export class PersonalServerResolver implements StreamResolver {
  private cache = new StreamCache();

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async resolve(videoId: string, opts?: { fresh?: boolean }): Promise<ResolvedStream> {
    if (opts?.fresh) this.cache.delete(videoId);
    const hit = this.cache.get(videoId);
    if (hit) return hit;
    const { url: base, token } = serverConfig();
    if (!base || !token) throw new Error('server: not configured');
    const video = /^([vm]):(.+)$/.exec(videoId);
    if (video?.[1] === 'v') throw new Error('server: adaptive video not supported');
    const id = video ? video[2] : videoId.replace(/^h:/, '');
    const kind = video ? 'video' : 'audio';
    const headers = { Authorization: `Bearer ${token}` };
    const t0 = Date.now();
    const res = await this.fetchFn(`${base}/resolve/${encodeURIComponent(id)}?kind=${kind}`, { headers });
    if (!res.ok) throw new Error(`server: resolve HTTP ${res.status}`);
    const info = (await res.json()) as ServerResolve;
    const stream: ResolvedStream = {
      url: `${base}/stream/${encodeURIComponent(id)}${kind === 'video' ? '?kind=video' : ''}`,
      mimeType: info.mimeType,
      contentLength: info.contentLength,
      expiresAt: Date.now() + 30 * 60_000,
      itag: info.itag,
      initRange: info.initRange,
      indexRange: info.indexRange,
      headers,
    };
    this.cache.set(videoId, stream);
    log('resolver', `server resolved ${videoId} itag=${info.itag} in ${Date.now() - t0}ms`);
    return stream;
  }
}

/** Round-trips `/health` for the Settings "Test connection" button. */
export async function testServer(url: string, token: string, fetchFn: typeof fetch = fetch): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetchFn(`${url}/health`, { headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - t0;
    if (res.status === 401 || res.status === 403) return { ok: false, latencyMs, detail: 'Token rejected' };
    if (!res.ok) return { ok: false, latencyMs, detail: `HTTP ${res.status}` };
    const j = (await res.json().catch(() => ({}))) as { ytdlp?: string };
    return { ok: true, latencyMs, detail: j.ytdlp ? `yt-dlp ${j.ytdlp}` : 'Connected' };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, detail: e instanceof Error && e.name === 'AbortError' ? 'Timed out' : 'Could not reach the server' };
  }
}
