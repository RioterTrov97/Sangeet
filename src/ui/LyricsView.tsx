/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutated by design */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Animated as RNAnimated, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { cancelAnimation, Easing, scrollTo, useAnimatedRef, useAnimatedStyle, useDerivedValue, useFrameCallback, useScrollOffset, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

import { usePlaybackClock } from '../lyrics/clock';
import { findActive, LOOKAHEAD_MS } from '../lyrics/clockMath';
import { stepSync, syncLabel, syncVisible, type LyricsSync } from '../lyrics/syncAdjust';
import { useSyncReveal } from '../lyrics/syncReveal';
import type { LrcLine } from '../lyrics/types';
import { seekTo } from '../player';
import { tap } from './haptic';
import { usePalette } from './palette/store';
import { LYRICS_ANCHOR } from './PlainLyrics';

const MANUAL_PAUSE_MS = 4000;
const ANCHOR = LYRICS_ANCHOR;
/** The intro dots show only when the first cue is at least this far in. */
const INTRO_MIN_S = 2.5;
const SCROLL_MS = 450;

/**
 * Synced lyrics: large bold centred lines; the active line is pure white, the others a warm tint of the palette at
 * 30-40 % opacity that fades with distance. A top and bottom fade mask softens the edges. Used both in the player
 * (compact, in place of the artwork) and on the full-screen lyrics route.
 */
export function LyricsView({ lines, offsetMs, compact, fade, sync }: { lines: LrcLine[]; offsetMs: number; compact?: boolean; /** Colour of the top / bottom edge fade (default: the palette background). */ fade?: string; /** The sync control: shown while the timing is a guess (video mode, unknown offset) or after the user adjusted it. */ sync?: LyricsSync }) {
  const palette = usePalette();
  const [height, setHeight] = useState(300);
  const clock = usePlaybackClock();
  const times = useMemo(() => lines.map((l) => l.time), [lines]);
  const activeSV = useSharedValue(-1);
  const aref = useAnimatedRef<Animated.ScrollView>();
  const offset = useScrollOffset(aref);
  const scrollY = useSharedValue(0);
  const ysSV = useSharedValue<number[]>([]);
  const heightSV = useSharedValue(300);
  const manualSV = useSharedValue(false);
  const ys = useRef<number[]>([]);
  const [pill, setPill] = useState(false);
  const dragged = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const offsetSV = useSharedValue(offsetMs + LOOKAHEAD_MS);
  useEffect(() => void (offsetSV.value = offsetMs + LOOKAHEAD_MS), [offsetMs, offsetSV]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => void (heightSV.value = height), [height, heightSV]);

  const targetFor = (idx: number): number => {
    'worklet';
    const y = ysSV.value[Math.max(0, idx)];
    return y == null ? 0 : Math.max(0, y - heightSV.value * ANCHOR);
  };

  // The active line is computed in the same frame callback that advances the clock, and the list scrolls from the same
  // place with a UI-thread timing animation: no React state or re-render per line, none per frame.
  useFrameCallback(() => {
    const idx = findActive(times, clock.value + offsetSV.value / 1000);
    if (idx !== activeSV.value) {
      activeSV.value = idx;
      if (!manualSV.value) scrollY.value = withTiming(targetFor(idx), { duration: SCROLL_MS, easing: Easing.out(Easing.cubic) });
    }
  });
  useDerivedValue(() => {
    if (!manualSV.value) scrollTo(aref, 0, scrollY.value, false);
  });
  const snapToActive = () => {
    cancelAnimation(scrollY);
    scrollY.value = withTiming(targetFor(activeSV.value), { duration: 0 });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(snapToActive, [height]);

  const beginDrag = () => {
    dragged.current = true;
    clearTimeout(timer.current);
    manualSV.value = true;
    cancelAnimation(scrollY);
    setPill(false);
  };
  const endDrag = () => {
    if (!dragged.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPill(true), MANUAL_PAUSE_MS);
  };
  const resume = () => {
    tap();
    clearTimeout(timer.current);
    dragged.current = false;
    scrollY.value = offset.value;
    manualSV.value = false;
    scrollY.value = withTiming(targetFor(activeSV.value), { duration: SCROLL_MS, easing: Easing.out(Easing.cubic) });
    setPill(false);
  };
  const fs = compact ? 24 : 30;
  const lineH = Math.round(fs * 1.28) + 18; // one line plus its vertical padding
  const pad = Math.max(0, height * ANCHOR - lineH / 2);
  
  return (
    <View style={styles.flex} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <Animated.ScrollView
        ref={aref}
        onScrollBeginDrag={beginDrag}
        onScrollEndDrag={endDrag}
        onMomentumScrollEnd={endDrag}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: pad, paddingBottom: Math.max(0, height * (1 - ANCHOR) - lineH / 2), paddingHorizontal: 22 }}>
        {lines[0] && lines[0].time >= INTRO_MIN_S ? <IntroDots firstTime={lines[0].time} clock={clock} offsetSV={offsetSV} activeSV={activeSV} top={Math.max(4, pad - 34)} /> : null}
        {lines.map((l, i) => (
          <Line
            key={i}
            index={i}
            line={l}
            fontSize={fs}
            dimColor={palette.lyricDim}
            activeSV={activeSV}
            clock={clock}
            offsetSV={offsetSV}
            onLayout={(e: LayoutChangeEvent) => {
              ys.current[i] = e.nativeEvent.layout.y + e.nativeEvent.layout.height / 2; // line centre
              ysSV.value = ys.current.slice();
              if (i === Math.max(0, activeSV.value) && !manualSV.value) snapToActive();
            }}
            onPress={() => {
              tap();
              void seekTo(Math.max(0, l.time - offsetMs / 1000));
              dragged.current = false;
              scrollY.value = offset.value;
              manualSV.value = false;
              setPill(false);
            }}
          />
        ))}
      </Animated.ScrollView>
      <LinearGradient pointerEvents="none" colors={[fade ?? palette.bg, `${fade ?? palette.bg}00`]} style={[styles.fade, styles.top, { height: height * 0.2 }]} />
      <LinearGradient pointerEvents="none" colors={[`${fade ?? palette.bg}00`, fade ?? palette.bg]} style={[styles.fade, styles.bottom, { height: height * 0.22 }]} />
      {sync && syncVisible(sync) ? <SyncPill sync={sync} /> : null}
      {pill ? (
        <Pressable style={styles.pill} onPress={resume} accessibilityRole="button" accessibilityLabel="Back to current line">
          <Text style={styles.pillText}>Back to current</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Sync affordance in the look of the unsynced view's badge: a plain caption at the top ("May be out of sync" / "Sync +1.0 s")
 * with a small up arrow under it (lyrics earlier) and a down arrow at the bottom edge (later), half a second a tap. Long-press
 * the caption, or tap the cross beside an adjusted value, to reset.
 */
function SyncPill({ sync }: { sync: LyricsSync }) {
  const { opacity, shown, reveal } = useSyncReveal();
  const mode = shown ? 'auto' : 'none';
  const step = (dir: 1 | -1) => (tap(), reveal(), sync.onChange(stepSync(sync.ms, dir)));
  return (
    <>
      <View style={styles.syncTop} pointerEvents="box-none">
        <View style={styles.syncRow}>
          <Pressable onPress={reveal} onLongPress={() => (tap(), sync.onChange(0))} accessibilityRole="button" accessibilityLabel={`${syncLabel(sync.ms)}. Tap for the timing arrows, long press to reset`}>
            <Text style={styles.uncertainText}>{syncLabel(sync.ms)}</Text>
          </Pressable>
          {sync.ms ? (
            <RNAnimated.View style={{ opacity }} pointerEvents={mode}>
              <Pressable hitSlop={10} onPress={() => (tap(), sync.onChange(0))} accessibilityRole="button" accessibilityLabel="Reset lyrics sync">
                <SymbolView name="xmark.circle.fill" size={13} tintColor="rgba(255,255,255,0.6)" />
              </Pressable>
            </RNAnimated.View>
          ) : null}
        </View>
        <RNAnimated.View style={{ opacity }} pointerEvents={mode}>
          <Pressable hitSlop={14} onPress={() => step(1)} accessibilityRole="button" accessibilityLabel="Lyrics earlier by half a second">
            <SymbolView name="chevron.up" size={16} tintColor="rgba(255,255,255,0.6)" />
          </Pressable>
        </RNAnimated.View>
      </View>
      <View style={styles.syncBottom} pointerEvents="box-none">
        <RNAnimated.View style={{ opacity }} pointerEvents={mode}>
          <Pressable hitSlop={14} onPress={() => step(-1)} accessibilityRole="button" accessibilityLabel="Lyrics later by half a second">
            <SymbolView name="chevron.down" size={16} tintColor="rgba(255,255,255,0.6)" />
          </Pressable>
        </RNAnimated.View>
      </View>
    </>
  );
}

/** Three dots above the first line that fill up as the first cue approaches; gone once the first line is active. */
function IntroDots({ firstTime, clock, offsetSV, activeSV, top }: { firstTime: number; clock: SharedValue<number>; offsetSV: SharedValue<number>; activeSV: SharedValue<number>; top: number }) {
  return (
    <View pointerEvents="none" style={[styles.dots, { top }]}>
      {[0, 1, 2].map((i) => (
        <IntroDot key={i} i={i} firstTime={firstTime} clock={clock} offsetSV={offsetSV} activeSV={activeSV} />
      ))}
    </View>
  );
}

function IntroDot({ i, firstTime, clock, offsetSV, activeSV }: { i: number; firstTime: number; clock: SharedValue<number>; offsetSV: SharedValue<number>; activeSV: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, (clock.value + offsetSV.value / 1000) / firstTime));
    const fill = Math.min(1, Math.max(0, p * 3 - i));
    return { opacity: activeSV.value >= 0 ? withTiming(0, { duration: 200 }) : 0.25 + 0.75 * fill, transform: [{ scale: 0.8 + 0.4 * fill }] };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

function Line({ index, line, fontSize, dimColor, activeSV, clock, offsetSV, onLayout, onPress }: { index: number; line: LrcLine; fontSize: number; dimColor: string; activeSV: SharedValue<number>; clock: SharedValue<number>; offsetSV: SharedValue<number>; onLayout: (e: LayoutChangeEvent) => void; onPress: () => void }) {
  const style = useAnimatedStyle(() => {
    const d = Math.abs(activeSV.value - index);
    const target = d === 0 ? 1 : Math.max(0.12, 0.4 - (d - 1) * 0.08);
    return { opacity: withTiming(target, { duration: 200 }) };
  });
  const color = useAnimatedStyle(() => ({ color: activeSV.value === index ? '#ffffff' : dimColor }));
  const text = { fontSize, lineHeight: Math.round(fontSize * 1.28) };
  return (
    <Pressable onLayout={onLayout} onPress={onPress} accessibilityRole="button" accessibilityLabel={line.text || 'Instrumental break'}>
      <Animated.View style={style}>
        {line.words?.length ? (
          <Text style={[styles.line, text]}>
            {line.words.map((w, k) => (
              <Word key={k} text={w.text} start={w.time} end={line.words![k + 1]?.time ?? w.time + 0.6} clock={clock} offsetSV={offsetSV} active={activeSV} index={index} dimColor={dimColor} fontSize={fontSize} />
            ))}
          </Text>
        ) : (
          <Animated.Text style={[styles.line, text, color]}>{line.text || '♪'}</Animated.Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

function Word({ text, start, end, clock, offsetSV, active, index, dimColor, fontSize }: { text: string; start: number; end: number; clock: SharedValue<number>; offsetSV: SharedValue<number>; active: SharedValue<number>; index: number; dimColor: string; fontSize: number }) {
  const style = useAnimatedStyle(() => {
    const p = (clock.value + offsetSV.value / 1000 - start) / Math.max(0.05, end - start);
    const sung = active.value === index && p >= 1;
    return { opacity: active.value !== index ? 1 : p <= 0 ? 0.45 : 0.45 + 0.55 * Math.min(1, p), color: active.value === index ? (sung || p > 0 ? '#ffffff' : dimColor) : dimColor };
  });
  return <Animated.Text style={[styles.line, { fontSize, lineHeight: Math.round(fontSize * 1.28) }, style]}>{text}</Animated.Text>;
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  dots: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 9, height: 14, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  syncTop: { position: 'absolute', top: 6, left: 0, right: 0, alignItems: 'center', gap: 4 },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  syncBottom: { position: 'absolute', bottom: 4, left: 0, right: 0, alignItems: 'center' },
  uncertainText: { color: 'rgba(255,255,255,0.65)', ...theme.typography.caption },
  line: { color: '#fff', fontFamily: theme.typography.display.fontFamily, textAlign: 'center', paddingVertical: 9 },
  fade: { position: 'absolute', left: 0, right: 0 },
  top: { top: 0 },
  bottom: { bottom: 0 },
  pill: { position: 'absolute', alignSelf: 'center', bottom: theme.spacing.lg, backgroundColor: '#fff', borderRadius: theme.radii.full, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  pillText: { color: '#000', ...theme.typography.heading },
}));
