import { Platform } from 'react-native';
import { create } from 'zustand';

import { useNet } from '../../downloads/net';
import { getJson, setJson } from '../../util/storage';
import { effectiveQuality, type AudioQuality, type DecoderCaps, type VideoQuality } from '../formats';

export type QualitySettings = {
  audio: AudioQuality;
  video: VideoQuality;
  /** Caps while on mobile data (phone only); 'same' = as on Wi-Fi. */
  audioMobile: AudioQuality | 'same';
  videoMobile: VideoQuality | 'same';
};

const KEY = 'quality.settings.v1';
const DEFAULTS: QualitySettings = { audio: 'max', video: 'max', audioMobile: 'same', videoMobile: 'same' };

export const useQuality = create<QualitySettings>(() => ({ ...DEFAULTS, ...(getJson<Partial<QualitySettings>>(KEY) ?? {}) }));

export function setQuality(patch: Partial<QualitySettings>): void {
  useQuality.setState(patch);
  const { audio, video, audioMobile, videoMobile } = useQuality.getState();
  setJson(KEY, { audio, video, audioMobile, videoMobile });
}

/** What the next resolve should use (Wi-Fi/ethernet vs mobile data, phone only). Read at resolve time: the current track is never touched. */
export function currentQuality(): { audio: AudioQuality; video: VideoQuality } {
  const q = useQuality.getState();
  const mobile = (Platform.OS === 'ios' || !Platform.isTV) && !useNet.getState().wifi;
  return { audio: effectiveQuality(q.audio, q.audioMobile, mobile), video: effectiveQuality(q.video, q.videoMobile, mobile) };
}

export const osName = (): 'ios' | 'android' => (Platform.OS === 'ios' ? 'ios' : 'android');

let caps: DecoderCaps | undefined;
/** Video decoders of this device (Android: MediaCodecList via the proxy module). iOS only ever uses avc1 <= 1080p. */
export function decoderCaps(read: () => DecoderCaps | undefined): DecoderCaps | undefined {
  caps ??= read();
  return caps;
}
