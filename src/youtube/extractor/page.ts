/**
 * Runs INSIDE the hidden WebView (origin https://www.youtube.com). Bundled by
 * scripts/build-extractor.mjs into extractorHtml.generated.ts. Not imported by app code.
 *
 * Responsibilities: youtubei.js Innertube session, BotGuard -> PoToken (bgutils-js),
 * deciphered + PoToken-signed audio URLs. Requests/responses use the protocol in ./protocol.
 */
import { BotGuardClient } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';
import { Constants, Innertube, Platform, Player, ProtoUtils } from 'youtubei.js/web';

import { classifyPlayability, clientsAfter } from '../playability';
import { formatNeedsPlayer, lazyByKey, lazyOnce, needsGvsPot, needsPlayer } from './plan';
import { selectAudio, selectVideo, type AudioQuality, type DecoderCaps, type FormatMeta, type Platform as OsName, type VideoQuality } from '../formats';

const w = window as any;
const BG_REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
/**
 * Stream clients in preference order (mirrors yt-dlp / NewPipe): VISIONOS needs neither a JS player nor a PO token,
 * TV is sent as yt-dlp's `tv_samsung`, MWEB and WEB_EMBEDDED need the GVS `pot`. IOS/ANDROID are out: their URLs 403 after the
 * first MiB without a player-request PO token, and ANDROID_VR 403s everywhere.
 */
const CLIENTS = ['VISIONOS', 'TV', 'MWEB', 'WEB_EMBEDDED'] as const;
const TV_SAMSUNG_UA = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1';
(Constants as any).CLIENTS.TV = { ...(Constants as any).CLIENTS.TV, NAME: 'TVHTML5', VERSION: '5.20260707', USER_AGENT: TV_SAMSUNG_UA };
/** The exact User-Agent the stream requests must carry for each client (URLs are issued to that client). */
const clientUserAgent = (client: string): string =>
  client === 'VISIONOS' ? (Constants as any).CLIENTS.VISIONOS.USER_AGENT : client === 'TV' ? TV_SAMSUNG_UA : navigator.userAgent;
/** Response with only a SABR streaming URL (no direct format URLs): unusable for a plain range proxy. */
const assertDirectUrls = (info: any) => {
  const sd = info.streaming_data;
  if (!sd?.adaptive_formats?.length && !sd?.formats?.length) throw new Error(sd?.server_abr_streaming_url ? 'SABR-only response (no direct URLs)' : 'no streaming data');
};
type ClientName = (typeof CLIENTS)[number];
type Attempt = { client: string; error?: string };
/** Honours the caller's ordered allow-list (the JS circuit breaker drops clients that keep failing). */
const pick = (list: unknown): readonly ClientName[] => {
  const want = Array.isArray(list) ? (list as string[]).filter((c): c is ClientName => (CLIENTS as readonly string[]).includes(c)) : [];
  return want.length ? want : CLIENTS;
};
/** After a failure whose reason says the video (not the client) is the problem, drops the clients that cannot do better (age-restricted still tries WEB_EMBEDDED). */
function skipAfter(queue: string[], message: string): void {
  const rest = clientsAfter(classifyPlayability(message), queue);
  if (rest.length < queue.length) log(`skipping ${queue.filter((c) => !rest.includes(c)).join(',')} (${classifyPlayability(message)})`);
  queue.splice(0, queue.length, ...rest);
}
/** Failure that carries every client's reason so JS can feed its breakers. */
const attemptsError = (what: string, attempts: Attempt[]) => new Error(`ATTEMPTS ${what} ${JSON.stringify(attempts)}`);

function post(msg: unknown) {
  w.ReactNativeWebView?.postMessage(JSON.stringify(msg));
}
const log = (message: string) => post({ type: 'log', message });

// Platform.shim.eval: the player script is evaluated with the WebView's own JS engine.
// youtubei.js captured an unbound globalThis.fetch ("Can only call Window.fetch on instances of Window").
Platform.shim.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input));
  try {
    // yt-dlp's tv_samsung also declares the device in the player request context.
    if (url.includes('/youtubei/v1/player') && typeof init?.body === 'string' && init.body.includes('"TVHTML5"')) {
      const b = JSON.parse(init.body);
      if (b?.context?.client?.clientName === 'TVHTML5') {
        Object.assign(b.context.client, { deviceMake: 'Samsung', deviceModel: 'UKS9800', osName: 'Tizen', osVersion: '2.4.0' });
        init = { ...init, body: JSON.stringify(b) };
      }
    }
    return await w.fetch(input, init);
  } catch (e) {
    log(`fetch failed ${url.slice(0, 120)}: ${e}`);
    throw e;
  }
}) as typeof fetch;
Platform.shim.eval = async (data: any) => new Function(data.output)();

type Session = { yt: any; visitorData: string };
let sessionPromise: Promise<Session> | undefined;
const timings: Record<string, number> = {};

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now();
  try {
    return await fn();
  } catch (e) {
    log(`step ${name} FAILED: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    throw e;
  } finally {
    timings[name] = Date.now() - t;
    log(`step ${name} ${timings[name]}ms`);
  }
}

/** The session is only Innertube + visitorData: no BotGuard, no JS player (both are loaded lazily, see below). */
async function createSession(): Promise<Session> {
  const yt: any = await step('innertube', () => Innertube.create({ retrieve_player: false, fetch: Platform.shim.fetch }));
  let visitorData: string = yt.session.context.client.visitorData ?? '';
  if (!visitorData) {
    // visionOS player requests without visitorData come back UNPLAYABLE: generate one the way youtubei.js does offline.
    visitorData = (ProtoUtils as any).encodeVisitorData(Math.random().toString(36).slice(2, 13).padEnd(11, 'x'), Math.floor(Date.now() / 1000));
    yt.session.context.client.visitorData = visitorData;
    log('visitorData was empty: generated locally');
  }
  return { yt, visitorData };
}

function ensureSession(): Promise<Session> {
  sessionPromise ??= createSession().catch((e) => {
    sessionPromise = undefined; // allow retry
    throw e;
  });
  return sessionPromise;
}

/** BotGuard + WAA GenerateIT -> WebPoMinter. Created on first need only (clients in NEEDS_GVS_POT), memoised, reset on failure. */
const minterOnce = lazyOnce(async () => {
  const { yt } = await ensureSession();
  return step('potoken', async () => {
    const challenge = await yt.getAttestationChallenge('ENGAGEMENT_TYPE_UNBOUND');
    const bg = challenge?.bg_challenge;
    if (!bg) throw new Error('No BotGuard challenge');
    const url: string = bg.interpreter_url.private_do_not_access_or_else_trusted_resource_url_wrapped_value;
    // Cross-origin script: must be loaded via <script src> (fetch would be blocked by CORS).
    await new Promise<void>((resolve, reject) => {
      const el = document.createElement('script');
      el.src = url.startsWith('//') ? `https:${url}` : url;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`interpreter script load failed: ${el.src}`));
      document.head.appendChild(el);
    });
    log('interpreter loaded');
    const client = await BotGuardClient.create({
      program: bg.program,
      globalName: bg.global_name,
      globalObject: globalThis,
    });
    const webPoSignalOutput: any[] = [];
    const botguardResponse = await client.snapshot({ webPoSignalOutput });
    log('botguard snapshot ok');
    const res = await fetch('https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json+protobuf',
        'x-goog-api-key': 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw',
        'x-user-agent': 'grpc-web-javascript/0.1',
      },
      body: JSON.stringify([BG_REQUEST_KEY, botguardResponse]),
    });
    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = await res.json();
    return WebPoMinter.create({ integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken }, webPoSignalOutput);
  });
});
const ensureMinter = () => minterOnce.get();

/** The JS player (base.js) is only needed to decipher signature / `n` or for the signatureTimestamp of non-VISIONOS clients. */
const playerOnce = lazyOnce(async () => {
  const { yt } = await ensureSession();
  if (!yt.session.player) yt.session.player = await step('player', () => Player.create(undefined, Platform.shim.fetch));
  return yt.session.player;
});
const ensurePlayer = () => playerOnce.get();

/** Per-call helper: the content PO token is minted the first time a client that needs it is tried, then reused for this call. */
function contentPotFor(videoId: string) {
  const once = lazyByKey(async (id: string) => {
    const m = await ensureMinter();
    return step('mint', () => m.mintAsWebsafeString(id)) as Promise<string>;
  });
  const state = { minted: false };
  return {
    state,
    /** Resolves the pot for a client, or undefined when it needs none. Logs which path was taken. */
    async forClient(client: string): Promise<string | undefined> {
      if (!needsGvsPot(client)) return undefined;
      if (!state.minted) log(`potoken: minted lazily for ${client}`);
      state.minted = true;
      return once(videoId);
    },
  };
}

/** After a client that needs no token resolved: build the minter in the background so a later fallback does not pay for it. */
function warmMinter() {
  if (minterOnce.started()) return;
  const run = () => void ensureMinter().catch((e) => log(`potoken warm-up failed: ${e}`));
  const ric = (window as any).requestIdleCallback;
  if (typeof ric === 'function') ric(run, { timeout: 5000 });
  else setTimeout(run, 1500);
}

/** Player request for one client: loads the player and the PO token only if that client needs them. */
async function playerInfo(s: Session, videoId: string, client: string, pot: ReturnType<typeof contentPotFor>, label?: string): Promise<any> {
  if (needsPlayer(client)) await ensurePlayer();
  const token = await pot.forClient(client);
  const run = () => s.yt.getBasicInfo(videoId, token ? { client, po_token: token } : { client });
  return label ? step(label, run) : run();
}

/** URL of a format; the player is only loaded if the format or client really needs deciphering. */
async function urlOf(s: Session, fmt: any, client: string, pot: ReturnType<typeof contentPotFor>): Promise<string> {
  const player = formatNeedsPlayer(client, fmt) ? await ensurePlayer() : undefined;
  const url: string = await fmt.decipher(player);
  if (!url) throw new Error('empty url');
  const u = new URL(url);
  const token = await pot.forClient(client);
  if (token && !u.searchParams.has('pot')) u.searchParams.set('pot', String(token));
  return u.toString();
}

const metaOf = (f: any): FormatMeta => ({ itag: f.itag, mime_type: String(f.mime_type), bitrate: Number(f.bitrate ?? 0), width: f.width, height: f.height, hasRanges: !!(f.init_range && f.index_range) });
const codecsOf = (mime: string) => /codecs="([^"]+)"/.exec(mime)?.[1] ?? '';

async function getStream(videoId: string, clients?: unknown, audio: AudioQuality = 'max', os: OsName = 'ios') {
  const s = await ensureSession();
  const pot = contentPotFor(videoId);
  const errors: Attempt[] = [];
  const queue = [...pick(clients)];
  for (let client = queue.shift(); client; client = queue.shift()) {
    try {
      const info: any = await playerInfo(s, videoId, client, pot, `player.${client}`);
      const status = info.playability_status?.status;
      if (status !== 'OK') throw new Error(`playability ${status}: ${info.playability_status?.reason ?? ''}`);
      assertDirectUrls(info);
      const formats: any[] = (info.streaming_data?.adaptive_formats ?? []).filter((f: any) => typeof f.mime_type === 'string' && f.mime_type.startsWith('audio/'));
      const hasHigh = formats.some((f) => f.itag === 141);
      const metas = formats.map(metaOf);
      const chosen = selectAudio(metas, audio, os);
      const fmt = chosen && formats[metas.indexOf(chosen)];
      if (!fmt) throw new Error(os === 'ios' ? 'no audio/mp4 formats' : 'no audio formats');
      const url: string = await step(`decipher.${client}`, () => urlOf(s, fmt, client, pot));
      const u = new URL(url);
      const expire = Number(u.searchParams.get('expire') ?? 0);
      const result = {
        url,
        mimeType: String(fmt.mime_type).split(';')[0],
        contentLength: Number(fmt.content_length ?? u.searchParams.get('clen') ?? 0),
        expiresAt: expire ? expire * 1000 : Date.now() + 300_000,
        itag: fmt.itag as number,
        initRange: fmt.init_range ? { start: Number(fmt.init_range.start), end: Number(fmt.init_range.end) } : undefined,
        indexRange: fmt.index_range ? { start: Number(fmt.index_range.start), end: Number(fmt.index_range.end) } : undefined,
        client,
        userAgent: clientUserAgent(client),
        timings: { ...timings },
        failed: errors,
        hasHigh,
        codecs: codecsOf(String(fmt.mime_type)),
        bitrate: Number(fmt.bitrate ?? 0),
        durationMs: Number(fmt.approx_duration_ms ?? 0),
      };
      if (!pot.state.minted) {
        log('potoken: skipped (not needed)');
        warmMinter();
      }
      log(`resolved ${videoId} via ${client} audio ${audio}/${os} -> itag ${result.itag} ${result.bitrate}bps (${formats.map((f) => f.itag).join(',')})`);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ client, error: msg });
      log(`client failed ${client}: ${msg}`);
      skipAfter(queue, msg);
    }
  }
  throw attemptsError('audio', errors);
}

/**
 * Video for video mode. kind 'adaptive': best video-only format within the quality cap (avc1 on iOS; avc1/vp9/av1 the device decodes on Android; paired with the audio HLS by the
 * proxy). kind 'muxed': itag 18 (360p avc1 + aac) progressive mp4, the fallback. MWEB offers both (no HLS/DASH manifest).
 */
async function getVideoStream(videoId: string, kind: 'adaptive' | 'muxed', clients?: unknown, video: VideoQuality = 'max', os: OsName = 'ios', caps?: DecoderCaps) {
  const s = await ensureSession();
  const pot = contentPotFor(videoId);
  const errors: Attempt[] = [];
  const queue = [...pick(clients)];
  for (let client = queue.shift(); client; client = queue.shift()) {
    try {
      const info: any = await playerInfo(s, videoId, client, pot);
      if (info.playability_status?.status !== 'OK') throw new Error(`playability ${info.playability_status?.status}: ${info.playability_status?.reason ?? ''}`);
      assertDirectUrls(info);
      const sd = info.streaming_data ?? {};
      let fmt: any;
      if (kind === 'muxed') {
        fmt = (sd.formats ?? []).find((f: any) => f.itag === 18) ?? (sd.formats ?? []).find((f: any) => String(f.mime_type).startsWith('video/mp4'));
      } else {
        const list: any[] = (sd.adaptive_formats ?? []).filter((f: any) => String(f.mime_type).startsWith('video/'));
        const metas = list.map(metaOf);
        const chosen = selectVideo(metas, video, os, caps);
        fmt = chosen && list[metas.indexOf(chosen)];
        log(`video pick ${video}/${os} -> ${fmt ? `${fmt.itag} ${fmt.width}x${fmt.height} ${String(fmt.mime_type)}` : 'none'} of ${metas.filter((m) => m.hasRanges).map((m) => `${m.itag}:${m.height}`).join(',')}`);
      }
      if (!fmt) throw new Error(`no ${kind} format`);
      const url: string = await urlOf(s, fmt, client, pot);
      const u = new URL(url);
      const expire = Number(u.searchParams.get('expire') ?? 0);
      const codecs = /codecs="([^"]+)"/.exec(String(fmt.mime_type))?.[1] ?? '';
      if (!pot.state.minted) {
        log('potoken: skipped (not needed)');
        warmMinter();
      }
      log(`video ${videoId} via ${client} ${kind} itag ${fmt.itag} ${fmt.width}x${fmt.height}`);
      return {
        url,
        mimeType: String(fmt.mime_type).split(';')[0],
        contentLength: Number(fmt.content_length ?? u.searchParams.get('clen') ?? 0),
        expiresAt: expire ? expire * 1000 : Date.now() + 300_000,
        itag: fmt.itag as number,
        initRange: fmt.init_range ? { start: Number(fmt.init_range.start), end: Number(fmt.init_range.end) } : undefined,
        indexRange: fmt.index_range ? { start: Number(fmt.index_range.start), end: Number(fmt.index_range.end) } : undefined,
        client,
        userAgent: clientUserAgent(client),
        timings: {},
        failed: errors,
        codecs: kind === 'muxed' ? codecs : codecs.split(',')[0].trim(),
        width: Number(fmt.width ?? 0),
        height: Number(fmt.height ?? 0),
        bitrate: Number(fmt.bitrate ?? 0),
        durationMs: Number(fmt.approx_duration_ms ?? 0),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ client, error: msg });
      skipAfter(queue, msg);
    }
  }
  throw attemptsError(`video-${kind}`, errors);
}

/** Diagnostic: which formats each client offers for a video (used to pick the video-mode strategy). */
async function probeFormats(videoId: string) {
  const s = await ensureSession();
  const pot = contentPotFor(videoId);
  const out: any[] = [];
  for (const client of CLIENTS) {
    try {
      const info: any = await playerInfo(s, videoId, client, pot);
      const sd = info.streaming_data ?? {};
      const brief = (f: any) => `${f.itag}:${String(f.mime_type).replace('; codecs=', ';')}:${f.width ?? ''}x${f.height ?? ''}:${f.bitrate ?? ''}`;
      out.push({ client, status: info.playability_status?.status, hls: !!sd.hls_manifest_url, dash: !!sd.dash_manifest_url, muxed: (sd.formats ?? []).map(brief), adaptive: (sd.adaptive_formats ?? []).map(brief) });
    } catch (e) {
      out.push({ client, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}


const handlers: Record<string, (params: any) => Promise<unknown>> = {
  getVideoStream: (p) => getVideoStream(String(p.videoId), p.kind === 'muxed' ? 'muxed' : 'adaptive', p.clients, p.video, p.os, p.caps),
  probeFormats: (p) => probeFormats(String(p.videoId)),
  init: async () => {
    await ensureSession();
    return { ok: true, timings };
  },
  getStream: (p) => getStream(String(p.videoId), p.clients, p.audio, p.os),
};

w.__rnRequest = async (raw: string) => {
  const req = JSON.parse(raw) as { id: number; method: string; params?: unknown };
  try {
    const handler = handlers[req.method];
    if (!handler) throw new Error(`Unknown method ${req.method}`);
    post({ type: 'response', id: req.id, ok: true, result: await handler(req.params) });
  } catch (e) {
    post({ type: 'response', id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};

window.addEventListener('error', (e) => log(`window.onerror ${e.message}`));
window.addEventListener('unhandledrejection', (e) => log(`unhandledrejection ${String((e as any).reason)}`));
post({ type: 'ready' });
