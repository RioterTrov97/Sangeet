/**
 * Pure stream-format selection shared by the extractor page (bundled into the WebView) and the app. No imports: the page
 * bundle stays small and the rules are unit-tested.
 */
export type AudioQuality = 'max' | 'high' | 'normal' | 'saver';
export type VideoQuality = 'max' | '2160' | '1440' | '1080' | '720' | '480' | '360';
export type Platform = 'ios' | 'android';

export const AUDIO_QUALITIES: AudioQuality[] = ['max', 'high', 'normal', 'saver'];
export const VIDEO_QUALITIES: VideoQuality[] = ['max', '2160', '1440', '1080', '720', '480', '360'];
export const AUDIO_LABEL: Record<AudioQuality, string> = { max: 'Maximum', high: 'High', normal: 'Normal', saver: 'Data saver' };
export const VIDEO_LABEL: Record<VideoQuality, string> = { max: 'Maximum', '2160': '2160p (4K)', '1440': '1440p', '1080': '1080p', '720': '720p', '480': '480p', '360': '360p' };

/** The subset of a youtubei.js format the rules need. */
export type FormatMeta = {
  itag: number;
  mime_type: string;
  bitrate?: number;
  width?: number;
  height?: number;
  /** DASH init + sidx ranges present (needed to merge or HLS-wrap a video-only stream). */
  hasRanges?: boolean;
};

/** Decoders the device can run, by codec family: the tallest frame it decodes and whether that decoder is hardware. */
export type DecoderCaps = Partial<Record<'avc1' | 'vp9' | 'av01', { maxHeight: number; hw: boolean }>>;

/** Cap applied to software decoders (a 4K software VP9/AV1 decode is a slideshow). */
export const SOFTWARE_MAX_HEIGHT = 1080;
export const SOFTWARE_MAX_HEIGHT_MODERN = 720;

const has = (f: FormatMeta, s: string) => f.mime_type.includes(s);
const byBitrate = (a: FormatMeta, b: FormatMeta) => (b.bitrate ?? 0) - (a.bitrate ?? 0);

/**
 * Itag preference per setting. AAC (audio/mp4) on both platforms: ExoPlayer could play Opus (itag 251/250/249) but the
 * MWEB Opus URLs answer 403 to every ranged request past the first ~768 KB through the proxy (seen on the TV
 * emulator), so Opus stays off until that is understood.
 */
const AUDIO_ORDER: Record<AudioQuality, number[]> = { max: [141, 140], high: [140], normal: [140], saver: [139, 140] };

/** Picks the audio format for the setting (audio/mp4 only). Falls back to the best offered (smallest for saver). */
export function selectAudio<T extends FormatMeta>(formats: T[], quality: AudioQuality, _platform: Platform): T | undefined {
  const ok = formats.filter((f) => has(f, 'audio/mp4'));
  if (!ok.length) return undefined;
  for (const itag of AUDIO_ORDER[quality]) {
    const hit = ok.find((f) => f.itag === itag);
    if (hit) return hit;
  }
  const sorted = [...ok].sort(byBitrate);
  return quality === 'saver' ? sorted[sorted.length - 1] : sorted[0];
}

/** Height cap of a video setting; `max` is unbounded (the device caps decide). */
export function heightCap(q: VideoQuality): number {
  return q === 'max' ? Infinity : Number(q);
}

function codecOf(f: FormatMeta): 'avc1' | 'vp9' | 'av01' | undefined {
  if (has(f, 'avc1')) return 'avc1';
  if (has(f, 'vp9') || has(f, 'vp09')) return 'vp9';
  if (has(f, 'av01')) return 'av01';
  return undefined;
}

/** Tallest frame this device decodes for a codec (0 = unsupported). Software decoders are capped. */
export function decodableHeight(codec: 'avc1' | 'vp9' | 'av01', caps: DecoderCaps): number {
  const c = caps[codec];
  if (!c) return 0;
  return c.hw ? c.maxHeight : Math.min(c.maxHeight, codec === 'avc1' ? SOFTWARE_MAX_HEIGHT : SOFTWARE_MAX_HEIGHT_MODERN);
}

/**
 * Best video-only stream not taller than the cap.
 *  - iOS: avc1 in mp4 (HLS fMP4 wrapped by the proxy), up to 1080p.
 *  - Android: avc1 / vp9 / av01 the device decodes. Tallest frame wins; at equal height avc1 > vp9 > av01 (the most
 *    compatible one), then the higher bitrate.
 */
export function selectVideo<T extends FormatMeta>(formats: T[], quality: VideoQuality, platform: Platform, caps: DecoderCaps = { avc1: { maxHeight: 1080, hw: true } }): T | undefined {
  const cap = heightCap(quality);
  const rank = { avc1: 0, vp9: 1, av01: 2 } as const;
  const usable = formats.filter((f) => {
    if (!f.hasRanges || !f.height || !f.width || !f.mime_type.startsWith('video/')) return false;
    const codec = codecOf(f);
    if (!codec) return false;
    if (platform === 'ios') return codec === 'avc1' && has(f, 'video/mp4') && f.height <= Math.min(cap, 1080);
    return f.height <= cap && f.height <= decodableHeight(codec, caps);
  });
  usable.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || rank[codecOf(a)!] - rank[codecOf(b)!] || byBitrate(a, b));
  return usable[0];
}

/** Subtitle text for a stream ("AAC 128 kbps", "Opus 160 kbps"). */
export function describeAudio(f: { itag: number; mime_type?: string; mimeType?: string; bitrate?: number }): string {
  const mime = f.mime_type ?? f.mimeType ?? '';
  const codec = /opus/.test(mime) || /webm/.test(mime) ? 'Opus' : 'AAC';
  return f.bitrate ? `${codec} ${Math.round(f.bitrate / 1000)} kbps` : codec;
}

/** Caps when on mobile data: per-setting override, or "same" (undefined) as on Wi-Fi. */
export function effectiveQuality<Q extends string>(base: Q, mobile: Q | 'same', onMobile: boolean): Q {
  return onMobile && mobile !== 'same' ? mobile : base;
}

/**
 * The video qualities worth offering on this device: Maximum plus every fixed height up to the tallest frame it decodes
 * (iOS: 1080p, H.264 only; Android: the best of its decoders, software decoders capped as in `selectVideo`).
 */
export function videoOptions(platform: Platform, caps: DecoderCaps | undefined): VideoQuality[] {
  const tallest = platform === 'ios' ? 1080 : Math.max(0, ...(['avc1', 'vp9', 'av01'] as const).map((c) => (caps ? decodableHeight(c, caps) : c === 'avc1' ? 1080 : 0)));
  return VIDEO_QUALITIES.filter((q) => q === 'max' || Number(q) <= tallest);
}
