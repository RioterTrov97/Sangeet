import { log } from '../util/log';
import { AUDIO_QUALITIES, VIDEO_QUALITIES, type AudioQuality, type VideoQuality } from '../youtube/formats';
import { setQuality } from '../youtube/resolver/qualitySettings';
import { playerState } from '../player/store';
import { enterVideo, exitVideo, useVideoStore } from './controller';

export const isVideoQuality = (v: unknown): v is VideoQuality => (VIDEO_QUALITIES as readonly unknown[]).includes(v);
export const isAudioQuality = (v: unknown): v is AudioQuality => (AUDIO_QUALITIES as readonly unknown[]).includes(v);

/**
 * Saves the quality (same setting as Settings) and applies it to the song that is playing now. Video: the picture is handed back
 * to the audio player and then to a fresh video at the same position, both hand-overs make-before-break, so playback never pauses.
 * Audio: the new quality is used from the next resolve (the current stream keeps playing; swapping it live needs a gap).
 */
export async function applyQuality(kind: 'audio' | 'video', value: string): Promise<void> {
  if (kind === 'video' ? !isVideoQuality(value) : !isAudioQuality(value)) return;
  setQuality(kind === 'video' ? { video: value as VideoQuality } : { audio: value as AudioQuality });
  log('quality', `${kind} set to ${value}`);
  const s = playerState();
  const track = s.queue[s.index];
  if (kind === 'video' && track && useVideoStore.getState().mode === 'video') {
    await exitVideo();
    await enterVideo(track);
  }
}
