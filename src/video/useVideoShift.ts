import { useRemote } from '../remote/phone';
import type { Track } from '../youtube/models';
import { useVideoStore } from './controller';
import { offsetSec, useOffsets } from './offsets';

/**
 * Seconds to add to song-timed cues (lyrics) for the recording that is playing: 0 in song mode, the song -> video
 * offset in video mode, undefined while in video mode with an offset nobody could determine ("may be out of sync").
 * Controlling a TV, the TV reports its mode and the offset it uses.
 */
export function useVideoShift(track: Track | undefined): number | undefined {
  const remote = useRemote((r) => r.status !== 'off');
  const tvMode = useRemote((r) => r.tvMode);
  const tvOffset = useRemote((r) => r.tvVideoOffset);
  const videoId = useVideoStore((s) => (s.mode === 'video' ? s.videoId : null));
  useOffsets((s) => s.map); // re-render when an offset gets decided
  if (remote) return tvMode === 'video' ? tvOffset : 0;
  if (!videoId || !track) return 0;
  return offsetSec(track.id, videoId);
}
