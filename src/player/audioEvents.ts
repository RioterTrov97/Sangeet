import { AppState } from 'react-native';

import AudioEvents from '../../modules/audio-events';
import { log } from '../util/log';
import { intent } from './intent';
import { ensureProxyAlive } from './proxy';
import { noteUserMove } from './queue';
import { playerState } from './store';

let started = false;

/**
 * Routes pauses we did not cause (remote commands from CarPlay / steering wheel / lock screen / AirPods,
 * audio interruptions from calls and Siri) into the intent machine, so the start watchdog never overrides them.
 * Call after the player is configured.
 */
export function startAudioEvents(): void {
  if (started) return;
  started = true;
  AudioEvents.addListener('onRemoteCommand', ({ command }) => {
    const s = playerState().status;
    const playing = s === 'playing' || s === 'buffering';
    log('intent', `remote command ${command} (status=${s})`);
    if (command === 'pause' || command === 'stop' || (command === 'toggle' && playing)) intent.cancel('remote');
    else {
      if (command === 'next' || command === 'previous') noteUserMove(); // the native player moves by itself on these
      intent.request();
      void ensureProxyAlive(); // a play after a long pause in the background: the proxy socket may be gone
    }
  });
  AppState.addEventListener('change', (st) => {
    if (st === 'active') void ensureProxyAlive();
  });
  AudioEvents.addListener('onInterruption', ({ phase }) => {
    log('intent', `interruption ${phase}`);
    if (phase === 'began') intent.cancel('interruption');
  });
  AudioEvents.start();
}
