/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutated by design */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { scrollTo, useAnimatedRef, useAnimatedScrollHandler, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { StyleSheet } from 'react-native-unistyles';

import { AUTO_PAUSE_MS, autoScroll, correctionFor, getCorrection, setCorrection } from '../lyrics/autoScroll';
import { usePlaybackClock } from '../lyrics/clock';
import { usePlayerStore } from '../player/store';
import { usePalette } from './palette/store';

/** Where the first line starts (fraction of the panel height from the top): the synced view's anchor. */
export const LYRICS_ANCHOR = 0.38;

/**
 * Unsynced lyrics: the first line starts on the same anchor as the synced view's active line, with bottom padding so
 * the last line can reach it too. They scroll slowly with the song (a straight line from ~8 % to ~95 % of its length,
 * driven by the UI-thread playback clock, so a seek jumps and a pause stops). Touching them pauses that for 4 s; the
 * place the user left them at becomes a per-song correction, so the scroll carries on from there at the same pace.
 * A small "not synced" badge sits at the top. Used by the player card, the Lyrics screen and the full-screen video overlay.
 */
export function PlainLyrics({ text, fontSize = 20, fade, trackId }: { text: string; fontSize?: number; /** Colour of the top / bottom edge fade (default: the palette background). */ fade?: string; /** Keys the per-song scroll correction. */ trackId?: string }) {
  const palette = usePalette();
  const [h, setH] = useState(0);
  const line = Math.round(fontSize * 1.5);
  const bg = fade ?? palette.bg;

  const clock = usePlaybackClock();
  const dur = usePlayerStore((s) => s.duration || s.queue[s.index]?.durationSec || 0);
  const aref = useAnimatedRef<Animated.ScrollView>();
  const durSV = useSharedValue(dur);
  const maxY = useSharedValue(0);
  const idSV = useSharedValue(trackId ?? '');
  const corr = useSharedValue(getCorrection(trackId));
  const dragging = useSharedValue(false);
  const momentum = useSharedValue(false);
  const resumeAt = useSharedValue(0);
  const pending = useSharedValue(false);
  const lastY = useSharedValue(0);
  const lastSet = useSharedValue(-9999);
  const dims = useRef({ h: 0, content: 0 });
  const size = () => void (maxY.value = Math.max(0, dims.current.content - dims.current.h));

  useEffect(() => void (durSV.value = dur), [dur, durSV]);
  useEffect(() => {
    idSV.value = trackId ?? '';
    corr.value = getCorrection(trackId);
    pending.value = false;
    resumeAt.value = 0;
    lastSet.value = -9999;
  }, [trackId, idSV, corr, pending, resumeAt, lastSet]);

  useFrameCallback(() => {
    if (dragging.value || momentum.value || Date.now() < resumeAt.value) return;
    const pos = clock.value;
    if (pending.value) {
      // The pause after a touch is over: what the user left on screen is the new correction for this song.
      pending.value = false;
      corr.value = correctionFor(lastY.value, pos, durSV.value, maxY.value);
      lastSet.value = -9999;
      scheduleOnRN(setCorrection, idSV.value, corr.value);
    }
    const y = autoScroll(pos, durSV.value, maxY.value, corr.value);
    if (Math.abs(y - lastSet.value) < 0.5) return; // paused (or nothing to move): leave the view alone
    lastSet.value = y;
    scrollTo(aref, 0, y, false);
  });

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      lastY.value = e.contentOffset.y;
    },
    onBeginDrag: () => {
      dragging.value = true;
    },
    onEndDrag: () => {
      dragging.value = false;
      pending.value = true;
      resumeAt.value = Date.now() + AUTO_PAUSE_MS;
    },
    onMomentumBegin: () => {
      momentum.value = true;
    },
    onMomentumEnd: () => {
      momentum.value = false;
      pending.value = true;
      resumeAt.value = Date.now() + AUTO_PAUSE_MS;
    },
  });

  return (
    <View
      style={styles.flex}
      onLayout={(e) => {
        dims.current.h = e.nativeEvent.layout.height;
        setH(e.nativeEvent.layout.height);
        size();
      }}>
      <Animated.ScrollView
        ref={aref}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={(_w, ch) => {
          dims.current.content = ch;
          size();
        }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: Math.max(0, h * LYRICS_ANCHOR - line / 2), paddingBottom: h * (1 - LYRICS_ANCHOR), paddingHorizontal: 22 }}>
        <Text style={[styles.plain, { fontSize, lineHeight: line }]}>{text}</Text>
      </Animated.ScrollView>
      <LinearGradient pointerEvents="none" colors={[bg, `${bg}00`]} style={[styles.fade, { top: 0, height: h * 0.16 }]} />
      <LinearGradient pointerEvents="none" colors={[`${bg}00`, bg]} style={[styles.fade, { bottom: 0, height: h * 0.2 }]} />
      <Text pointerEvents="none" style={styles.badge}>
        Lyrics not synced
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  fade: { position: 'absolute', left: 0, right: 0 },
  badge: { position: 'absolute', top: 6, alignSelf: 'center', color: 'rgba(255,255,255,0.65)', ...theme.typography.caption },
  plain: { color: '#fff', fontFamily: theme.typography.title.fontFamily, textAlign: 'center' },
}));
