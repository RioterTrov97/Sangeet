import Constants from 'expo-constants';
import { useEffect } from 'react';
import { AppState, Pressable, Switch, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { checkForUpdate, installNow, openInstallSettings, refreshCanInstall, setAutoUpdate, updateNow, updaterAvailable, useUpdate } from '../update/store';
import { statusLine } from '../update/text';

/** Re-reads "Install unknown apps" whenever the app comes back to the front (the user may have just allowed it). */
export function useCanInstallRefresh(): void {
  useEffect(() => {
    refreshCanInstall();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refreshCanInstall());
    return () => sub.remove();
  }, []);
}

/** Android only, and only in builds that know where their releases live (src/update/config.ts); null otherwise. */
export const updatesAvailable = (): boolean => updaterAvailable();

/** Settings > Updates: version, check now, install, auto-install. Same policy as the TV: never interrupts playback. */
export function UpdatesNote() {
  const u = useUpdate();
  return <Text style={styles.note}>{u.release ? `v${u.release.version} available` : 'Up to date'}</Text>;
}

export function UpdatesSection() {
  const { theme } = useUnistyles();
  const u = useUpdate();
  useCanInstallRefresh();
  const busy = u.status === 'checking' || u.status === 'downloading' || u.status === 'installing';
  const blocked = !u.canInstall && !!u.release;
  return (
    <View style={styles.wrap}>
      <Text style={styles.body}>Version {Constants.expoConfig?.version ?? ''}</Text>
      <Text style={styles.body} accessibilityLiveRegion="polite">{statusLine(u)}</Text>
      <View style={styles.row}>
        <Pressable style={styles.btn} disabled={busy} onPress={() => void checkForUpdate({ force: true })} accessibilityRole="button" accessibilityLabel="Check for updates">
          <Text style={styles.btnText}>{u.status === 'checking' ? 'Checking…' : 'Check for updates'}</Text>
        </Pressable>
        {u.status === 'ready' && u.canInstall ? (
          <Pressable style={[styles.btn, styles.btnOn]} onPress={() => void installNow()} accessibilityRole="button" accessibilityLabel="Install update">
            <Text style={[styles.btnText, styles.btnOnText]}>Install update</Text>
          </Pressable>
        ) : null}
        {u.status === 'available' || (u.status === 'error' && u.release) ? (
          <Pressable style={[styles.btn, styles.btnOn]} onPress={() => void updateNow()} accessibilityRole="button" accessibilityLabel="Download and install update">
            <Text style={[styles.btnText, styles.btnOnText]}>Download and install</Text>
          </Pressable>
        ) : null}
      </View>
      {blocked ? (
        <>
          <Text style={styles.body}>Android has to allow Sangeet to install apps (Install unknown apps) before it can update itself.</Text>
          <Pressable style={styles.btn} onPress={openInstallSettings} accessibilityRole="button" accessibilityLabel="Allow installs">
            <Text style={styles.btnText}>Allow installs</Text>
          </Pressable>
        </>
      ) : null}
      <View style={styles.switchRow}>
        <Text style={styles.switchText}>Install updates automatically</Text>
        <Switch value={u.autoUpdate} onValueChange={setAutoUpdate} accessibilityLabel="Install updates automatically" trackColor={{ true: theme.colors.accent }} />
      </View>
      <Text style={styles.body}>Downloads in the background and installs when nothing is playing.</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm },
  body: { color: theme.colors.textSecondary, ...theme.typography.body },
  note: { color: theme.colors.textTertiary, ...theme.typography.body },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  btn: { alignSelf: 'flex-start', paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, borderRadius: theme.radii.full, backgroundColor: theme.colors.surfaceElevated },
  btnOn: { backgroundColor: theme.colors.accent },
  btnText: { color: theme.colors.text, ...theme.typography.heading },
  btnOnText: { color: '#000' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  switchText: { flex: 1, color: theme.colors.text, ...theme.typography.bodyLarge },
}));
