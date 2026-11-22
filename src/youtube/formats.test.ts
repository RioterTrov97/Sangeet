import { describeAudio, effectiveQuality, selectAudio, selectVideo, type DecoderCaps, type FormatMeta, videoOptions } from './formats';

const a = (itag: number, mime: string, bitrate: number): FormatMeta => ({ itag, mime_type: mime, bitrate });
const AUDIO = [
  a(139, 'audio/mp4; codecs="mp4a.40.5"', 49000),
  a(140, 'audio/mp4; codecs="mp4a.40.2"', 130000),
  a(141, 'audio/mp4; codecs="mp4a.40.2"', 256000),
  a(249, 'audio/webm; codecs="opus"', 50000),
  a(250, 'audio/webm; codecs="opus"', 70000),
  a(251, 'audio/webm; codecs="opus"', 160000),
];
const v = (itag: number, mime: string, w: number, h: number, bitrate = h * 1000): FormatMeta => ({ itag, mime_type: mime, width: w, height: h, bitrate, hasRanges: true });
const AVC = (h: number, itag: number) => v(itag, 'video/mp4; codecs="avc1.640028"', Math.round((h * 16) / 9), h);
const VP9 = (h: number, itag: number) => v(itag, 'video/webm; codecs="vp9"', Math.round((h * 16) / 9), h);
const AV1 = (h: number, itag: number) => v(itag, 'video/mp4; codecs="av01.0.12M.08"', Math.round((h * 16) / 9), h);
const VIDEO = [AVC(360, 134), AVC(720, 136), AVC(1080, 137), VP9(1080, 248), VP9(2160, 313), AV1(2160, 701)];

describe('selectAudio', () => {
  it('iOS only plays AAC: max is 141 when offered, else 140', () => {
    expect(selectAudio(AUDIO, 'max', 'ios')?.itag).toBe(141);
    expect(selectAudio(AUDIO.filter((f) => f.itag !== 141), 'max', 'ios')?.itag).toBe(140);
    expect(selectAudio(AUDIO, 'high', 'ios')?.itag).toBe(140);
    expect(selectAudio(AUDIO, 'saver', 'ios')?.itag).toBe(139);
    expect(selectAudio(AUDIO.filter((f) => f.itag === 251), 'max', 'ios')).toBeUndefined();
  });
  it('Android uses the same AAC ladder (Opus is off, see formats.ts)', () => {
    expect(selectAudio(AUDIO, 'max', 'android')?.itag).toBe(141);
    expect(selectAudio(AUDIO, 'high', 'android')?.itag).toBe(140);
    expect(selectAudio(AUDIO, 'normal', 'android')?.itag).toBe(140);
    expect(selectAudio(AUDIO, 'saver', 'android')?.itag).toBe(139);
  });
  it('falls back to the best (or smallest for saver) offered format', () => {
    const odd = [a(999, 'audio/mp4; codecs="x"', 90000), a(998, 'audio/mp4; codecs="x"', 30000)];
    expect(selectAudio(odd, 'max', 'ios')?.itag).toBe(999);
    expect(selectAudio(odd, 'saver', 'ios')?.itag).toBe(998);
  });
  it('describes the stream', () => {
    expect(describeAudio({ itag: 140, mime_type: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000 })).toBe('AAC 130 kbps');
    expect(describeAudio({ itag: 251, mimeType: 'audio/webm', bitrate: 160000 })).toBe('Opus 160 kbps');
  });
});

describe('selectVideo', () => {
  it('iOS: avc1 mp4 only, capped at the setting and at 1080p', () => {
    expect(selectVideo(VIDEO, 'max', 'ios')?.itag).toBe(137);
    expect(selectVideo(VIDEO, '720', 'ios')?.itag).toBe(136);
    expect(selectVideo(VIDEO, '360', 'ios')?.itag).toBe(134);
    expect(selectVideo(VIDEO, '480', 'ios')?.itag).toBe(134);
  });
  it('Android with hardware VP9/AV1 reaches 4K for maximum', () => {
    const caps: DecoderCaps = { avc1: { maxHeight: 1080, hw: true }, vp9: { maxHeight: 2160, hw: true }, av01: { maxHeight: 2160, hw: true } };
    expect(selectVideo(VIDEO, 'max', 'android', caps)?.itag).toBe(313); // vp9 before av1 at equal height
    expect(selectVideo(VIDEO, '1080', 'android', caps)?.itag).toBe(137); // avc1 before vp9 at equal height
    expect(selectVideo(VIDEO, '720', 'android', caps)?.itag).toBe(136);
  });
  it('Android ignores codecs it cannot decode and caps software decoders', () => {
    expect(selectVideo(VIDEO, 'max', 'android', { avc1: { maxHeight: 1080, hw: true } })?.itag).toBe(137);
    const sw: DecoderCaps = { avc1: { maxHeight: 1080, hw: false }, vp9: { maxHeight: 2160, hw: false } };
    expect(selectVideo(VIDEO.filter((f) => f.itag !== 137 && f.itag !== 248), 'max', 'android', sw)?.itag).toBe(136);
  });
  it('skips formats without init/index ranges', () => {
    expect(selectVideo([{ ...AVC(720, 136), hasRanges: false }], 'max', 'ios')).toBeUndefined();
  });
});

describe('effectiveQuality', () => {
  it('uses the mobile override only on mobile data', () => {
    expect(effectiveQuality('max', 'normal', true)).toBe('normal');
    expect(effectiveQuality('max', 'normal', false)).toBe('max');
    expect(effectiveQuality('high', 'same', true)).toBe('high');
  });
});


describe('videoOptions', () => {
  it('offers Maximum plus every height up to what the device decodes', () => {
    expect(videoOptions('ios', undefined)).toEqual(['max', '1080', '720', '480', '360']);
    expect(videoOptions('android', { avc1: { maxHeight: 1080, hw: true } })).toEqual(['max', '1080', '720', '480', '360']);
    expect(videoOptions('android', { avc1: { maxHeight: 1080, hw: true }, vp9: { maxHeight: 2160, hw: true } })).toEqual(['max', '2160', '1440', '1080', '720', '480', '360']);
  });
  it('caps software decoders', () => {
    expect(videoOptions('android', { vp9: { maxHeight: 2160, hw: false } })).toEqual(['max', '720', '480', '360']);
    expect(videoOptions('android', undefined)).toEqual(['max', '1080', '720', '480', '360']);
  });
});
