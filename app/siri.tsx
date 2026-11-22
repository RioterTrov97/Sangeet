import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import SiriMedia from '../modules/siri-media';
import { log } from '../src/util/log';

/** Dev-only: `sangeet://siri?payload=<json of SiriIntentInput>` injects a fake intent through the real native -> JS path. */
export default function SiriDev() {
  const { payload, t } = useLocalSearchParams<{ payload?: string; t?: string }>();
  useEffect(() => {
    if (__DEV__ && payload) {
      log('siri', `dev inject ${payload}`);
      SiriMedia.inject(payload);
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [payload, t]);
  return null;
}
