import { Platform } from 'react-native';
import { TrackPlayer } from 'react-native-nitro-player';
import { callbackManager } from 'react-native-nitro-player/src/hooks/callbackManager';

import { setRepeat, setShuffle } from './queue';
import { playerState, usePlayerStore } from './store';

let started = false;

/** CarPlay Now Playing shuffle / repeat toggles <-> our queue model (the native toggle only flips its icon). */
export function startNowPlayingButtons(): void {
  if (started || Platform.OS !== 'ios') return;
  started = true;
  callbackManager.subscribeToNotificationButtonPress((id, _track, event) => {
    if (id === 'shuffle') void setShuffle(!!event.isActive);
    if (id === 'repeat') void setRepeat(event.isActive ? 'all' : 'off');
  });
  const sync = () => {
    const s = playerState();
    TrackPlayer.setNotificationButtonState({ buttonId: 'shuffle', isActive: s.shuffle });
    TrackPlayer.setNotificationButtonState({ buttonId: 'repeat', isActive: s.repeat !== 'off' });
  };
  usePlayerStore.subscribe((s, prev) => {
    if (s.shuffle !== prev.shuffle || s.repeat !== prev.repeat) sync();
  });
}
