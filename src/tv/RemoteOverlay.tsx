import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useHostUi } from '../remote/hostUi';
import { useNotice } from '../util/notice';
import { tv } from './theme';

/** The brief "Controlled by <phone>" toast (top right) and the playback notice (bottom, e.g. why a song cannot play), above everything else. */
export function RemoteOverlay() {
  const toast = useHostUi((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => useHostUi.setState((s) => (s.toast?.id === toast.id ? { toast: undefined } : s)), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  const notice = useNotice((s) => s.text);
  return (
    <>
      {notice ? (
        <View style={st.notice} pointerEvents="none" accessibilityLiveRegion="polite">
          <Text style={st.toastText}>{notice}</Text>
        </View>
      ) : null}
      {toast ? (
        <View style={st.toast} pointerEvents="none">
          <Text style={st.toastText}>{toast.text}</Text>
        </View>
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  toast: { position: 'absolute', top: 32, right: 48, backgroundColor: 'rgba(30,30,34,0.96)', borderRadius: 40, paddingVertical: 16, paddingHorizontal: 32, borderWidth: 1, borderColor: '#3a3a40' },
  notice: { position: 'absolute', bottom: 48, left: 96, right: 96, alignItems: 'center', backgroundColor: 'rgba(30,30,34,0.96)', borderRadius: 40, paddingVertical: 16, paddingHorizontal: 32, borderWidth: 1, borderColor: '#3a3a40' },
  toastText: { color: '#fff', fontFamily: tv.font.bold, fontSize: 26 },
});
