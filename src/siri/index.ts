import { Platform } from 'react-native';

import SiriMedia from '../../modules/siri-media';
import { log, logWarn } from '../util/log';
import { handleSiriIntent } from './handler';
import type { SiriIntentInput } from './mapIntent';
import { startVocabularySync } from './vocabulary';

let started = false;

/**
 * Boot hook (plain module, no React): registers the listener for Siri intents. Intents that arrived before JS booted
 * were queued natively and are delivered as soon as `ready()` runs. CarPlay cold launches are headless, so this lives in boot.ts.
 */
export function startSiri(): void {
  if (started || Platform.OS !== 'ios') return;
  started = true;
  try {
    SiriMedia.addListener('onIntent', (e) => {
      let input: SiriIntentInput;
      try {
        input = JSON.parse(e.payload) as SiriIntentInput;
      } catch {
        SiriMedia.complete(e.id, 'failure');
        return;
      }
      void handleSiriIntent(input).then((code) => SiriMedia.complete(e.id, code));
    });
    SiriMedia.ready();
    startVocabularySync();
    log('siri', 'listener registered');
  } catch (e) {
    logWarn('siri', 'native module unavailable', e instanceof Error ? e.message : e);
  }
}
