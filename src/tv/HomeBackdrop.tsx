import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, interpolateColor, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useArtworkColor } from '../ui/artworkColor';
import { useBackdrop } from './ui';
import { tv } from './theme';

/** The artwork and tint cover the top of the screen only: the gradient is almost opaque below, and every full-screen pass costs real time on the Streamer's GPU. */
const TOP = { position: 'absolute', left: 0, right: 0, top: 0, height: '72%' } as const;
const FADE_MS = 450;
/** The image's resting opacity lives on its layer (not on the image inside it): a nested alpha costs an extra full-screen offscreen pass on every frame. */
const IMG_OPACITY = 0.6;
const DEBOUNCE_MS = 150;
/** Start the fade anyway if the image never reports `onLoad`. */
const LOAD_TIMEOUT_MS = 1500;

type Slot = 'a' | 'b';
const other = (s: Slot): Slot => (s === 'a' ? 'b' : 'a');

/**
 * Heavily blurred, darkened artwork of the focused card. Two stacked layers: the next image is prefetched and loaded
 * in the hidden layer first, then faded in over the current one (which stays fully opaque underneath, so there is never
 * an empty or black frame). Rapid D-pad movement is debounced, and the tint colour is interpolated, not switched.
 */
export function HomeBackdrop() {
  const target = useBackdrop((s) => s.current);
  const [want, setWant] = useState(target);
  useEffect(() => {
    const id = setTimeout(() => setWant(target), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [target]);

  const [uris, setUris] = useState<Record<Slot, string | undefined>>({ a: undefined, b: undefined });
  const [top, setTop] = useState<Slot>('a');
  const [pending, setPending] = useState<Slot | undefined>();
  const opA = useSharedValue(0);
  const opB = useSharedValue(0);
  const prog = useSharedValue(0);
  const cFrom = useSharedValue<string>(tv.bg);
  const cTo = useSharedValue<string>(tv.bg);
  const fading = useRef(false);
  const queued = useRef<string | undefined>(undefined);
  const shown = useRef<string | undefined>(undefined);
  const color = useArtworkColor(want);
  useEffect(() => {
    cTo.value = color;
  }, [color, cTo]);

  const start = (slot: Slot) => {
    if (fading.current) return;
    fading.current = true;
    const mine = slot === 'a' ? opA : opB;
    const old = slot === 'a' ? opB : opA;
    mine.value = withTiming(IMG_OPACITY, { duration: FADE_MS, easing: Easing.inOut(Easing.quad) });
    prog.value = withTiming(1, { duration: FADE_MS, easing: Easing.inOut(Easing.quad) }, (done) => {
      if (done) runOnJS(finish)(slot, old === opA ? 'a' : 'b');
    });
  };
  const finish = (slot: Slot, oldSlot: Slot) => {
    (oldSlot === 'a' ? opA : opB).value = 0;
    cFrom.value = cTo.value;
    prog.value = 0;
    fading.current = false;
    setTop(slot);
    setPending(undefined);
    const next = queued.current;
    queued.current = undefined;
    if (next && next !== shown.current) begin(next, slot);
  };
  const begin = (uri: string, currentTop: Slot) => {
    const slot = other(currentTop);
    shown.current = uri;
    void Image.prefetch(uri).catch(() => false);
    setUris((u) => ({ ...u, [slot]: uri }));
    setPending(slot);
    setTimeout(() => start(slot), LOAD_TIMEOUT_MS);
  };
  const loaded = (slot: Slot) => {
    if (pending === slot) start(slot);
  };

  useEffect(() => {
    if (!want || want === shown.current) return;
    if (fading.current || pending) {
      queued.current = want;
      return;
    }
    if (!shown.current) {
      // First image: fill the top layer straight away and fade it in.
      shown.current = want;
      setUris((u) => ({ ...u, a: want }));
      setTop('b');
      setPending('a');
      setTimeout(() => start('a'), LOAD_TIMEOUT_MS);
      return;
    }
    begin(want, top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want]);

  const styleA = useAnimatedStyle(() => ({ opacity: opA.value }));
  const styleB = useAnimatedStyle(() => ({ opacity: opB.value }));
  const tint = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(prog.value, [0, 1], [cFrom.value, cTo.value]) }));
  const z = (s: Slot) => ({ zIndex: pending === s ? 2 : top === s ? 1 : 0 });

  return (
    <View style={{ position: 'absolute', left: -tv.rail, right: 0, top: 0, bottom: 0 }} pointerEvents="none">
      <Animated.View style={[TOP, tint, { opacity: 0.4 }]} />
      {(['a', 'b'] as const).map((s) => (
        <Animated.View key={s} style={[TOP, s === 'a' ? styleA : styleB, z(s)]}>
          {uris[s] ? <Image source={{ uri: uris[s] }} style={StyleSheet.absoluteFill} blurRadius={70} contentFit="cover" onLoad={() => loaded(s)} /> : null}
        </Animated.View>
      ))}
      <LinearGradient colors={['rgba(14,14,16,0.25)', 'rgba(14,14,16,0.82)', tv.bg]} locations={[0, 0.55, 1]} style={[TOP, { height: '73%', zIndex: 3 }]} />
    </View>
  );
}

