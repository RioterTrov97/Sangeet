import { PermissionsAndroid, Platform } from 'react-native';

import { log } from '../util/log';
import { getJson, setJson } from '../util/storage';
import { usePlayerStore } from './store';

const ASKED = 'android.notifPermissionAsked';

/**
 * Android 13+ hides the media notification (and its lock-screen controls) until POST_NOTIFICATIONS is granted. Ask once, the first
 * time music plays, so the question comes with a reason. Phones only (the TV has no notification shade); a no-op elsewhere.
 */
export function startNotificationPermission(): void {
  if (Platform.OS !== 'android' || Platform.isTV || Number(Platform.Version) < 33 || getJson<boolean>(ASKED)) return;
  const unsub = usePlayerStore.subscribe((s) => {
    if (s.status !== 'playing') return;
    unsub();
    setJson(ASKED, true);
    void PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS')
      .then((r) => log('boot', `notification permission: ${r}`))
      .catch(() => {});
  });
}
