import { useSegments } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { openInstallSettings, startUpdater, updateNow, updaterAvailable, useUpdate } from '../update/store';
import { pillText, plainNotes } from '../update/text';
import { Icon } from './Icon';
import { useFloatingInset } from './floating';
import { openCustomSheet, dismissActionSheet } from './sheet';
import { useCanInstallRefresh } from './UpdatesSection';

/** Android phones only: start the updater a few seconds after the UI is up (a no-op unless this build knows its releases). */
export function useStartUpdater(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || Platform.OS !== 'android' || Platform.isTV) return;
    let stop: (() => void) | undefined;
    const id = setTimeout(() => (stop = startUpdater()), 4000);
    return () => {
      clearTimeout(id);
      stop?.();
    };
  }, [enabled]);
}

/**
 * Non-blocking "Update ready" banner above the floating bars (Android only). Tap it for what is new and Install / Later;
 * it never installs by itself while music plays (that is the store's policy) and never covers the player.
 */
export function UpdateBanner() {
  const s = useUpdate();
  const bottom = useFloatingInset();
  const segments = useSegments() as string[];
  // Only on the tab screens (Home, Search, Library), where the floating bars it sits above exist.
  if (segments.length && segments[0] !== '(tabs)') return null;
  if (Platform.OS !== 'android' || Platform.isTV || !updaterAvailable()) return null;
  const text = pillText(s);
  if (!text) return null;
  return (
    <View style={[styles.wrap, { bottom: bottom + 52 }]} pointerEvents="box-none">
      <Pressable style={styles.pill} onPress={openUpdateSheet} accessibilityRole="button" accessibilityLabel={`${text}. Show details`}>
        <Icon name="arrow.up.circle.fill" size={18} tintColor="#000" />
        <Text style={styles.text}>{text}</Text>
      </Pressable>
    </View>
  );
}

function openUpdateSheet() {
  openCustomSheet(() => <UpdateSheet />, { title: 'Update' });
}

function UpdateSheet() {
  const s = useUpdate();
  useCanInstallRefresh();
  const v = s.release?.version;
  const notes = s.release ? plainNotes(s.release.notes) : '';
  const busy = s.status === 'downloading' || s.status === 'installing';
  const blocked = !s.canInstall && (s.status === 'ready' || s.status === 'available');
  const label = blocked ? 'Allow installs' : s.status === 'downloading' ? `Downloading ${Math.round(s.progress * 100)}%` : s.status === 'installing' ? 'Installing…' : s.status === 'ready' ? 'Install now' : s.status === 'error' ? 'Try again' : 'Download and install';
  const go = () => {
    if (busy) return;
    if (blocked) return openInstallSettings();
    dismissActionSheet();
    void updateNow();
  };
  return (
    <View style={styles.sheet}>
      <Text style={styles.sheetTitle}>{v ? `Sangeet ${v}` : 'Update'}</Text>
      {notes ? (
        <ScrollView style={styles.notes}>
          <Text style={styles.sheetBody}>{notes}</Text>
        </ScrollView>
      ) : null}
      {blocked ? <Text style={styles.warn}>Allow Sangeet to install apps (Install unknown apps) so it can update itself.</Text> : null}
      {s.status === 'error' && s.error ? <Text style={styles.warn}>{s.error}</Text> : null}
      <View style={styles.row}>
        <Pressable style={[styles.btn, styles.btnOn]} onPress={go} accessibilityRole="button" accessibilityLabel={label}>
          <Text style={[styles.btnText, styles.btnOnText]}>{label}</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={dismissActionSheet} accessibilityRole="button" accessibilityLabel="Later">
          <Text style={styles.btnText}>Later</Text>
        </Pressable>
      </View>
      <Text style={styles.sheetBody}>Music keeps playing; with automatic updates on, Sangeet installs only when nothing is playing.</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: theme.spacing.lg },
  pill: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, backgroundColor: theme.colors.accent, borderRadius: theme.radii.full, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  text: { color: '#000', ...theme.typography.heading },
  sheet: { gap: theme.spacing.md },
  sheetTitle: { color: theme.colors.text, ...theme.typography.heading },
  sheetBody: { color: theme.colors.textSecondary, ...theme.typography.body },
  notes: { maxHeight: 220 },
  warn: { color: '#ffd479', ...theme.typography.body },
  row: { flexDirection: 'row', gap: theme.spacing.sm },
  btn: { flex: 1, alignItems: 'center', paddingVertical: theme.spacing.md, borderRadius: theme.radii.full, backgroundColor: theme.colors.surfaceElevated },
  btnOn: { backgroundColor: theme.colors.accent },
  btnText: { color: theme.colors.text, ...theme.typography.heading },
  btnOnText: { color: '#000' },
}));
