import { closeLocalPlayer, restoreClosedQueue, snapshotQueue } from '../player/queue';
import { closePlayer } from '../player/closePlayer';
import { isRemote } from '../player/remoteFlag';
import { setPlayerState } from '../player/store';
import { connectTv, currentTvLink, disconnectTv } from '../remote/phone';
import { showNotice } from '../util/notice';
import { stopVideo } from '../video/controller';
import { tap } from './haptic';

/** Swipe down / "Close player": see `closePlayer`. Local: stop + clear (Undo restores paused). Remote: leave the TV, which keeps playing. */
export function closeMiniPlayer(): Promise<void> {
  return closePlayer({
    isRemote,
    snapshot: snapshotQueue,
    // Video mode: the video player is what is playing (the audio is paused), so stop it first.
    closeLocal: async () => {
      await stopVideo();
      await closeLocalPlayer();
    },
    restoreLocal: restoreClosedQueue,
    tvLink: currentTvLink,
    disconnectTv: () => {
      disconnectTv();
      // Hide the mini player even if the phone had a local queue behind the TV session (that queue stays saved).
      setPlayerState({ queue: [], index: 0, original: null, status: 'idle', position: 0, duration: 0 });
    },
    connectTv: (l) => connectTv(l.target, { name: l.name, tvId: l.tvId }),
    notify: (text, undo) => showNotice(text, 5000, { label: 'Undo', onPress: undo }),
    haptic: tap,
  });
}
