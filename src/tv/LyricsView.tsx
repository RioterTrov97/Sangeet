/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutated by design */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated as RNAnimated, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useFrameCallback, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { onTvKey, setCapturedKeys, type DpadKey } from '../../modules/tv-keys';
import { AUTO_PAUSE_MS, autoScroll, correctionFor, getCorrection, setCorrection } from '../lyrics/autoScroll';
import { usePlaybackClock } from '../lyrics/clock';
import { findActive, LOOKAHEAD_MS } from '../lyrics/clockMath';

import { syncLabel, syncVisible, type LyricsSync } from '../lyrics/syncAdjust';
import { useSyncReveal } from '../lyrics/syncReveal';
import type { LrcLine } from '../lyrics/types';
import { usePlayerStore } from '../player/store';
import { markActivity } from './activity';
import { Icon } from './icons';
import { Focusable } from './ui';
import { tv } from './theme';

/** `overlay`: the immersive Video + Lyrics panel on the right of a full-screen video (left aligned, readable over the scrim). */
export type LyricsVariant = 'side' | 'full' | 'overlay';

const SIZES = { side: { font: 34, line: 44, gap: 10, dim: 0.8 }, full: { font: 50, line: 62, gap: 14, dim: 0.66 }, overlay: { font: 40, line: 52, gap: 12, dim: 0.84 } } as const;
/** Where the active line sits (fraction of the panel height from the top). */
const ANCHOR = 0.42;
const FADE = 110;
const FADE_MS = 200;
const SCROLL_MS = 450;

/** Opacity by distance from the active line: ahead of it dims gently, already-sung lines dim more. */
export function lineOpacity(i: number, active: number): number {
  'worklet';
  if (active < 0) return Math.max(0.25, 0.6 - i * 0.08);
  if (i === active) return 1;
  const d = i - active;
  return d > 0 ? Math.max(0.3, 0.56 - (d - 1) * 0.1) : Math.max(0.16, 0.3 - (-d - 1) * 0.05);
}

function Line({ text, i, activeSV, v, onLayout }: { text: string; i: number; activeSV: SharedValue<number>; v: LyricsVariant; onLayout: (y: number, h: number) => void }) {
  const z = SIZES[v];
  const style = useAnimatedStyle(() => {
    const on = activeSV.value === i;
    return { opacity: withTiming(lineOpacity(i, activeSV.value), { duration: FADE_MS }), transform: [{ scale: withTiming(on ? 1 : z.dim, { duration: FADE_MS }) }] };
  });
  return (
    <Animated.View onLayout={(e) => onLayout(e.nativeEvent.layout.y, e.nativeEvent.layout.height)} style={[{ paddingVertical: z.gap / 2 }, v === 'overlay' && { transformOrigin: 'left center' }, style]}>
      <Text style={[st.line, { fontSize: z.font, lineHeight: z.line }, v === 'overlay' && st.lineOverlay]}>{text || '♪'}</Text>
    </Animated.View>
  );
}

/** The intro indicator shows only when the first cue is at least this far in (a shorter wait is not worth a distraction). */
const INTRO_MIN_S = 2.5;

/** One of the three intro dots: fills (brighter, a little larger) as the clock approaches the first cue; gone once the first line is active. */
function IntroDot({ i, firstTime, clock, offsetSV, activeSV }: { i: number; firstTime: number; clock: SharedValue<number>; offsetSV: SharedValue<number>; activeSV: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, (clock.value + offsetSV.value / 1000) / firstTime));
    const fill = Math.min(1, Math.max(0, p * 3 - i));
    return { opacity: activeSV.value >= 0 ? withTiming(0, { duration: FADE_MS }) : 0.22 + 0.78 * fill, transform: [{ scale: 0.8 + 0.4 * fill }] };
  });
  return <Animated.View style={[st.dot, style]} />;
}

/** Three dots above the first line that fill up as the first cue approaches (Apple Music style). */
function IntroDots({ top, left, ...rest }: { firstTime: number; clock: SharedValue<number>; offsetSV: SharedValue<number>; activeSV: SharedValue<number>; top: number; left: boolean }) {
  return (
    <View pointerEvents="none" style={[st.dots, { top }, left ? { left: 0 } : { left: 0, right: 0, justifyContent: 'center' }]}>
      {[0, 1, 2].map((i) => (
        <IntroDot key={i} i={i} {...rest} />
      ))}
    </View>
  );
}

/**
 * The sync affordance, in the look of the plain lyrics' "Lyrics not synced" badge: a small caption at the top ("May be out of
 * sync", or "Sync +1.0 s" once adjusted) with a dim up arrow under it and a dim down arrow at the bottom edge. With the Now Playing
 * controls hidden, D-pad Up / Down move the lyrics 0.5 s earlier / later (NowPlayingTV); each change flashes the caption and arrows.
 */
function SyncHint({ sync }: { sync: LyricsSync }) {
  const [flash, setFlash] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 700);
    return () => clearTimeout(id);
  }, [sync.ms]);
  const c = flash ? '#fff' : 'rgba(255,255,255,0.7)';
  const { opacity } = useSyncReveal();
  return (
    <>
      <View pointerEvents="none" style={st.hintTop}>
        <Text style={[st.unsynced, flash && { color: '#fff' }]}>{syncLabel(sync.ms)}</Text>
        <RNAnimated.View style={{ opacity }}>
          <Icon name="back" size={26} color={c} rotate={90} />
        </RNAnimated.View>
      </View>
      <RNAnimated.View pointerEvents="none" style={[st.chev, { bottom: 4, opacity }]}>
        <Icon name="back" size={26} color={c} rotate={-90} />
      </RNAnimated.View>
    </>
  );
}

/**
 * Synced lyrics: the active line is big and bright in a fixed spot, the rest scroll past dimmed. The clock, the active
 * line, the list position and every highlight run on the UI thread (Reanimated) - no React state changes while playing.
 * The first line is on the anchor from the very first frame (the list is measured while invisible, then faded in), with
 * dimmed first line and filling dots during the intro; the last line can reach the anchor too (the list is translated, not scrolled).
 */
function SyncedLines({ synced, offsetMs, variant, sync }: { synced: LrcLine[]; offsetMs: number; variant: LyricsVariant; sync?: LyricsSync }) {
  const clock = usePlaybackClock();
  const times = useMemo(() => synced.map((l) => l.time), [synced]);
  const activeSV = useSharedValue(-1);
  const heightSV = useSharedValue(400);
  const geo = useSharedValue<{ y: number; h: number }[]>([]);
  const ty = useSharedValue(0);
  const shown = useSharedValue(0);
  const offsetSV = useSharedValue(offsetMs + LOOKAHEAD_MS);
  const [dotsTop, setDotsTop] = useState<number | undefined>(undefined);
  const visible = syncVisible(sync);
  useEffect(() => void (offsetSV.value = offsetMs + LOOKAHEAD_MS), [offsetMs, offsetSV]);
  const target = (idx: number): number => {
    'worklet';
    const g = geo.value[Math.max(0, idx)];
    return g ? heightSV.value * ANCHOR - (g.y + g.h / 2) : 0;
  };
  useFrameCallback(() => {
    if (!shown.value) return;
    const idx = findActive(times, clock.value + offsetSV.value / 1000);
    if (idx !== activeSV.value) {
      activeSV.value = idx;
      ty.value = withTiming(target(idx), { duration: SCROLL_MS, easing: Easing.out(Easing.cubic) });
    }
  });
  const ys = useRef<{ y: number; h: number }[]>([]);
  const height = useRef(400);
  const measured = useRef(0);
  const flush = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Puts the list on the active line (the first one before the first cue) without animating, then reveals it. */
  const publish = () => {
    flush.current = undefined;
    if (measured.current < synced.length || !height.current) return;
    geo.value = ys.current.slice();
    heightSV.value = height.current;
    const idx = findActive(times, clock.value + offsetSV.value / 1000);
    activeSV.value = idx;
    cancelAnimation(ty);
    const g = ys.current[Math.max(0, idx)];
    ty.value = g ? height.current * ANCHOR - (g.y + g.h / 2) : 0;
    const f = ys.current[0];
    if (f) setDotsTop(f.y - 44);
    shown.value = withTiming(1, { duration: 160 });
  };
  const schedule = () => {
    if (flush.current === undefined) flush.current = setTimeout(publish, 0);
  };
  useEffect(() => () => clearTimeout(flush.current), []);
  const list = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: ty.value }] }));
  return (
    <View
      style={{ flex: 1, overflow: 'hidden' }}
      onLayout={(e) => {
        height.current = e.nativeEvent.layout.height;
        if (measured.current >= synced.length) schedule();
      }}>
      <Animated.View style={list}>
        {synced.map((l, i) => (
          <Line
            key={i}
            text={l.text}
            i={i}
            activeSV={activeSV}
            v={variant}
            onLayout={(y, h) => {
              if (!ys.current[i]) measured.current++;
              ys.current[i] = { y, h };
              // Every line reports its layout when the lyrics mount; publishing the whole table per line is quadratic
              // (and each copy crosses to the UI thread), so publish once per batch.
              schedule();
            }}
          />
        ))}
        {dotsTop !== undefined && times[0] >= INTRO_MIN_S ? <IntroDots firstTime={times[0]} clock={clock} offsetSV={offsetSV} activeSV={activeSV} top={dotsTop} left={variant === 'overlay'} /> : null}
      </Animated.View>
      {visible && sync ? <SyncHint sync={sync} /> : null}
    </View>
  );
}

const PLAIN_STEP = 140;
/** Scrolls the plain lyrics by about three lines; false when already at that end. Now Playing uses it to scroll them while the controls are hidden. */
export type PlainScroller = (dir: 'up' | 'down') => boolean;

/**
 * Plain (untimed) lyrics drift down slowly with the song (a straight line from ~8 % to ~95 % of its length, stepped twice a
 * second from the player store: no per-frame work), a small "Lyrics not synced" label, and D-pad Up/Down scroll them while
 * the panel has focus (at either end the key moves focus on). A manual scroll pauses the drift for 4 s and then becomes a
 * per-song correction, so it carries on from where the user left it.
 * `idle` is the Now Playing controls' hidden state: it re-asserts the key capture after the controls change theirs.
 */
function PlainLyrics({ plain, trackId, variant, idle, onActivity, scrollRef }: { plain: string; trackId?: string; variant: LyricsVariant; idle: boolean; onActivity?: () => void; scrollRef?: React.RefObject<PlainScroller | null> }) {
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [focused, setFocused] = useState(false);
  const [more, setMore] = useState({ up: false, down: false });
  const y = useRef(0);
  const dims = useRef({ h: 400, content: 0 });
  const [panelH, setPanelH] = useState(0);
  const maxY = () => Math.max(0, dims.current.content - dims.current.h);
  const hints = () => {
    const up = y.current > 0;
    const down = y.current < maxY() - 1;
    setMore((m) => (m.up === up && m.down === down ? m : { up, down }));
  };
  const auto = useRef({ corr: getCorrection(trackId), pauseUntil: 0, pending: false });
  const focusedRef = useRef(false);
  /** Scrolls by about three lines; false (and nothing moves) when already at that end. */
  const step = (dir: 'up' | 'down'): boolean => {
    const to = Math.max(0, Math.min(maxY(), y.current + (dir === 'down' ? PLAIN_STEP : -PLAIN_STEP)));
    if (to === y.current) return false;
    auto.current.pauseUntil = Date.now() + AUTO_PAUSE_MS;
    auto.current.pending = true;
    y.current = to;
    scroll.current?.scrollTo({ y: to, animated: true });
    hints();
    return true;
  };
  useEffect(() => {
    if (scrollRef) scrollRef.current = step;
    return () => {
      if (scrollRef) scrollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef]);
  useEffect(() => {
    auto.current = { corr: getCorrection(trackId), pauseUntil: 0, pending: false };
  }, [trackId]);
  const capture = () => {
    const keys: DpadKey[] = [];
    if (y.current > 0) keys.push('up');
    if (y.current < maxY() - 1) keys.push('down');
    setCapturedKeys(keys);
  };
  // The drift: twice a second, while playing and not paused by a manual scroll.
  useEffect(() => {
    const iv = setInterval(() => {
      const a = auto.current;
      if (Date.now() < a.pauseUntil) return;
      const s = usePlayerStore.getState();
      const dur = s.duration || s.queue[s.index]?.durationSec || 0;
      if (a.pending) {
        a.pending = false;
        a.corr = correctionFor(y.current, s.position, dur, maxY());
        setCorrection(trackId, a.corr);
      }
      if (s.status !== 'playing') return;
      const to = autoScroll(s.position, dur, maxY(), a.corr);
      if (Math.abs(to - y.current) < 1) return;
      y.current = to;
      scroll.current?.scrollTo({ y: to, animated: true });
      hints();
      if (focusedRef.current) capture();
    }, 500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);
  useEffect(() => {
    focusedRef.current = focused;
    if (!focused) return;
    capture();
    const sub = onTvKey(({ key }) => {
      if (key !== 'up' && key !== 'down') return;
      markActivity();
      onActivity?.();
      step(key);
      capture();
    });
    return () => {
      sub.remove();
      setCapturedKeys([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, idle]);
  const big = variant !== 'side';
  const plainLine = big ? (variant === 'overlay' ? 42 : 48) : 40;
  return (
    <Focusable wrapStyle={{ flex: 1 }} dim={false} scale={1} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} label="Lyrics, not synced. Up and down to scroll" style={st.plainWrap} focusedStyle={st.plainOn}>
      <Text style={st.unsynced}>Lyrics not synced</Text>
      <ScrollView
        ref={scroll}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        fadingEdgeLength={FADE}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: Math.max(0, panelH * ANCHOR - plainLine / 2), paddingBottom: panelH * (1 - ANCHOR) }}
        onLayout={(e) => {
          dims.current.h = e.nativeEvent.layout.height;
          setPanelH(e.nativeEvent.layout.height);
        }}
        onContentSizeChange={(_w, ch) => ((dims.current.content = ch), hints())}>
        <Text style={[st.plain, big && { fontSize: variant === 'overlay' ? 30 : 34, lineHeight: variant === 'overlay' ? 42 : 48 }, variant === 'overlay' && st.plainLeft]}>{plain}</Text>
      </ScrollView>
      {more.up ? <View pointerEvents="none" style={[st.chev, { top: 30 }]}><Icon name="back" size={26} color="rgba(255,255,255,0.7)" rotate={90} /></View> : null}
      {more.down ? <View pointerEvents="none" style={[st.chev, { bottom: 4 }]}><Icon name="back" size={26} color="rgba(255,255,255,0.7)" rotate={-90} /></View> : null}
    </Focusable>
  );
}

export function LyricsView({ synced, plain, trackId, status, offsetMs, variant, sync, idle = false, onActivity, scrollRef }: { synced: LrcLine[]; plain?: string; trackId?: string; status: 'loading' | 'ready' | 'none'; offsetMs: number; variant: LyricsVariant; /** The sync hint (caption + arrows): shown while the timing is a guess or after an adjustment. */ sync?: LyricsSync; idle?: boolean; onActivity?: () => void; scrollRef?: React.RefObject<PlainScroller | null> }) {
  if (status === 'loading') return <Text style={st.msg}>Looking for lyrics...</Text>;
  if (!synced.length && !plain) return <Text style={st.msg}>No lyrics found for this song.</Text>;
  if (!synced.length) return <PlainLyrics plain={plain!} trackId={trackId} variant={variant} idle={idle} onActivity={onActivity} scrollRef={scrollRef} />;
  return <SyncedLines key={`${synced.length}:${synced[0].time}:${synced[0].text}`} synced={synced} offsetMs={offsetMs} variant={variant} sync={sync} />;
}

const st = StyleSheet.create({
  line: { color: '#fff', fontFamily: tv.font.extraBold, textAlign: 'center' },
  lineOverlay: { textAlign: 'left', textShadowColor: 'rgba(0,0,0,0.85)', textShadowRadius: 12 },
  plainWrap: { flex: 1, borderRadius: 16, borderWidth: 2, borderColor: 'transparent', paddingHorizontal: 8 },
  plainOn: { borderColor: 'rgba(255,255,255,0.35)' },
  unsynced: { color: 'rgba(255,255,255,0.6)', fontFamily: tv.font.bold, fontSize: 18, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center', paddingTop: 6 },
  plainLeft: { textAlign: 'left', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  chev: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  dots: { position: 'absolute', flexDirection: 'row', gap: 12, height: 20, alignItems: 'center' },
  dot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff' },
  hintTop: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  msg: { color: 'rgba(255,255,255,0.7)', fontFamily: tv.font.medium, fontSize: 26, textAlign: 'center', marginTop: 40 },
  plain: { color: 'rgba(255,255,255,0.85)', fontFamily: tv.font.medium, fontSize: 28, lineHeight: 40, textAlign: 'center' },
});
