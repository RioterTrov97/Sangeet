import { Image } from 'expo-image';
import { useEffect } from 'react';
import { BackHandler, Modal, StyleSheet, Text, View } from 'react-native';

import { suspendCapture } from '../../modules/tv-keys';
import { useNowPlaying } from '../player';
import { usePalette } from '../ui/palette/store';
import { useBackgroundPlay } from './playerPrefs';
import { DESIGN_W, useTvWindow } from './scale';
import { tv } from './theme';
import { Focusable, ring } from './ui';

/**
 * "Exit Sangeet?" over the dimmed current screen. It is an Android dialog window (RN Modal), so the D-pad can only move
 * between its own buttons: focus can never escape to the screen behind it. Back = Stay; OK on Exit finishes the activity.
 * The Modal renders outside TVApp's scaled root, so it applies the same design-space scale itself.
 */
export function ExitDialog({ onStay }: { onStay: () => void }) {
  const pal = usePalette();
  const { track, isPlaying } = useNowPlaying();
  const keep = useBackgroundPlay((s) => s.on);
  const { height, scale } = useTvWindow();
  // Keys captured by the screen behind (idle controls, seek bar) would be swallowed before they reach the dialog's buttons.
  useEffect(() => suspendCapture(), []);
  const note = isPlaying || track ? (keep ? 'Music keeps playing' : isPlaying ? 'Music will stop' : '') : '';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onStay} statusBarTranslucent navigationBarTranslucent>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.72)' }]} />
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: DESIGN_W,
          height,
          transformOrigin: 'top left',
          transform: [{ scale }],
        }}
      >
        <View style={st.root}>
          <View style={[st.card, isPlaying && { backgroundColor: `${pal.bgDeep}f2` }]}>
            <Image source={require('../../assets/images/icon.png')} style={st.icon} />
            <Text style={st.title}>Exit Sangeet?</Text>
            {note ? <Text style={st.sub}>{note}</Text> : null}
            <View style={st.row}>
              <Focusable preferred onPress={onStay} label="Stay" scale={1.06} style={[st.btn, { backgroundColor: '#fff' }]} focusedStyle={ring}>
                <Text style={[st.btnText, { color: '#000' }]}>Stay</Text>
              </Focusable>
              <Focusable
                onPress={() => BackHandler.exitApp()}
                label="Exit"
                scale={1.06}
                style={[st.btn, { backgroundColor: 'rgba(255,255,255,0.14)' }]}
                focusedStyle={ring}
              >
                <Text style={st.btnText}>Exit</Text>
              </Focusable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: 640,
    alignItems: 'center',
    paddingVertical: 44,
    paddingHorizontal: 48,
    borderRadius: 32,
    backgroundColor: 'rgba(28,28,32,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  icon: { width: 88, height: 88, borderRadius: 20, marginBottom: 22 },
  title: { color: '#fff', fontFamily: tv.font.extraBold, fontSize: 40 },
  sub: {
    color: tv.textDim,
    fontFamily: tv.font.medium,
    fontSize: 24,
    marginTop: 8,
  },
  row: { flexDirection: 'row', gap: 20, marginTop: 34 },
  btn: {
    height: 72,
    minWidth: 220,
    paddingHorizontal: 36,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: '#fff', fontFamily: tv.font.bold, fontSize: 28 },
});
