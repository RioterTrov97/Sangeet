import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { runDevCommand } from '../src/dev/driver';
import { devDriverEnabled } from '../src/dev/flags';

/** Dev and screenshot builds only: runs a player command from a deep link, then returns to the previous screen. */
export default function Dev() {
  const { cmd, a, b, t } = useLocalSearchParams<{ cmd?: string; a?: string; b?: string; t?: string }>();
  useEffect(() => {
    if (devDriverEnabled && cmd) runDevCommand(cmd, a, b);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [cmd, a, b, t]);
  return null;
}
