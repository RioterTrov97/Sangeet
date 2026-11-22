import { useEffect } from 'react';
import { AppState, Modal, StyleSheet, Text, View } from 'react-native';
import { create } from 'zustand';

import { suspendCapture } from '../../modules/tv-keys';
import { openInstallSettings, refreshCanInstall, updateNow, updaterAvailable, useUpdate } from '../update/store';
import { pillText, plainNotes } from '../update/text';
import { SAFE_X, SAFE_Y } from './grid';
import { DESIGN_W, useTvWindow } from './scale';
import { tv } from './theme';
import { Focusable, ring } from './ui';

/** Whether the "Update X.Y.Z" dialog is open (opened from the Home pill). */
const useUpdateDialog = create<{ open: boolean }>(() => ({ open: false }));
const setDialog = (open: boolean): void => useUpdateDialog.setState({ open });

/** Re-reads "Install unknown apps" whenever the app comes back to the front (the user may have just allowed it). */
export function useCanInstallRefresh(): void {
  useEffect(() => {
    refreshCanInstall();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refreshCanInstall());
    return () => sub.remove();
  }, []);
}

/** Small non-blocking pill on Home. Never preferred, so it does not take initial focus. `shift` leaves room for the Now playing pill. */
export function UpdatePill({ shift }: { shift: boolean }) {
  const s = useUpdate();
  const text = updaterAvailable() ? pillText(s) : null;
  if (!text) return null;
  return (
    <View style={[st.pillWrap, shift && { right: SAFE_X + 270 }]} pointerEvents="box-none">
      <Focusable onPress={() => setDialog(true)} label={text} scale={1.06} style={st.pill} focusedStyle={{ backgroundColor: '#fff' }}>
        {(f) => (
          <>
            <View style={[st.dot, f && { backgroundColor: '#000' }]} />
            <Text style={[st.pillText, f && { color: '#000' }]}>{text}</Text>
          </>
        )}
      </Focusable>
    </View>
  );
}

/** Update dialog: what is new, Install / Later. An Android dialog window like ExitDialog, so focus stays inside it. */
export function UpdateDialog() {
  const open = useUpdateDialog((d) => d.open);
  return open ? <DialogBody /> : null;
}

function DialogBody() {
  const s = useUpdate();
  const { height, scale } = useTvWindow();
  useEffect(() => suspendCapture(), []);
  useCanInstallRefresh();
  const close = () => setDialog(false);
  const v = s.release?.version;
  // The update went away (installed, or the check found nothing): nothing left to show.
  useEffect(() => {
    if (!v) setDialog(false);
  }, [v]);
  const notes = s.release ? plainNotes(s.release.notes) : '';
  const busy = s.status === 'downloading' || s.status === 'installing';
  const blocked = !s.canInstall && (s.status === 'ready' || s.status === 'available');
  const label = blocked ? 'Allow installs' : s.status === 'downloading' ? `Downloading ${Math.round(s.progress * 100)}%` : s.status === 'installing' ? 'Installing…' : s.status === 'ready' ? 'Install now' : s.status === 'error' ? 'Try again' : 'Download and install';
  const go = () => {
    if (busy) return;
    if (blocked) return openInstallSettings();
    close();
    void updateNow();
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.72)' }]} />
      <View style={{ position: 'absolute', left: 0, top: 0, width: DESIGN_W, height, transformOrigin: 'top left', transform: [{ scale }] }}>
        <View style={st.root}>
          <View style={st.card}>
            <Text style={st.title}>Update {v}</Text>
            {notes ? <Text style={st.notes} numberOfLines={10}>{notes}</Text> : null}
            {blocked ? <Text style={st.warn}>Allow Sangeet to install apps (Install unknown apps) so it can update itself.</Text> : null}
            {s.status === 'error' && s.error ? <Text style={st.warn}>{s.error}</Text> : null}
            <View style={st.row}>
              <Focusable preferred onPress={go} label={label} scale={1.06} style={[st.btn, { backgroundColor: '#fff' }]} focusedStyle={ring}>
                <Text style={[st.btnText, { color: '#000' }]}>{label}</Text>
              </Focusable>
              <Focusable onPress={close} label="Later" scale={1.06} style={[st.btn, { backgroundColor: 'rgba(255,255,255,0.14)' }]} focusedStyle={ring}>
                <Text style={st.btnText}>Later</Text>
              </Focusable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  pillWrap: { position: 'absolute', top: SAFE_Y - 6, right: SAFE_X },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 60, paddingHorizontal: 24, borderRadius: 30, backgroundColor: 'rgba(20,20,24,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  pillText: { color: '#fff', fontFamily: tv.font.bold, fontSize: 22 },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: tv.accent },
  root: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  card: { width: 760, paddingVertical: 40, paddingHorizontal: 48, borderRadius: 32, backgroundColor: 'rgba(28,28,32,0.96)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  title: { color: '#fff', fontFamily: tv.font.extraBold, fontSize: 40 },
  notes: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 24, lineHeight: 32, marginTop: 16 },
  warn: { color: '#ffd479', fontFamily: tv.font.medium, fontSize: 22, marginTop: 16 },
  row: { flexDirection: 'row', gap: 20, marginTop: 34 },
  btn: { height: 72, minWidth: 260, paddingHorizontal: 36, borderRadius: 36, borderWidth: 3, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontFamily: tv.font.bold, fontSize: 28 },
});
