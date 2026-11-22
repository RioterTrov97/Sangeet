import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, FlatList, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { create } from 'zustand';

import { playTracks, togglePlay } from '../player';
import { pressAction } from '../player/currentRule';
import { playerState } from '../player/store';
import { itemSubtitle, itemTitle } from '../ui/itemText';
import { Artwork } from '../ui/Artwork';
import { tileColor } from '../ui/palette/tiles';
import { moodIcon, tileShapes } from '../ui/moodTileArt';
import { useMoodPage } from '../youtube/queries';
import { queryClient } from '../youtube/queryClient';
import Svg, { Path } from 'react-native-svg';
import { Image } from 'expo-image';
import type { Mood } from '../youtube/api';
import { pickArtwork } from '../youtube/mappers/common';
import type { MusicItem, Track } from '../youtube/models';
import { perfEnd } from '../util/perf';
import { perfFocus, perfOn } from '../util/perfMode';
import { markActivity } from './activity';
import { Icon, tvMoodIcon, type IconName } from './icons';
import { tvNav } from './nav';
import { tv } from './theme';

/** The content item that had focus last: `claim` makes it the preferred focus (the system gives it focus when it is shown), `release` drops that again. False from claim when it is gone. */
export type ContentFocus = { claim: () => boolean; release: () => void };
let lastContent: ContentFocus | undefined;
/** Takes focus back to the content element that had it last (if it is still mounted); false when it is gone. */
export const reclaimContentFocus = (): boolean => {
  const c = lastContent;
  if (!c || !c.claim()) return false;
  setTimeout(c.release, 120);
  return true;
};
/** The current last-focused content item, to claim later (a root screen's, captured before another screen replaces it). */
export const contentFocusSnapshot = (): ContentFocus | undefined => lastContent;

/** Focus look of a green primary button: it stays green (slightly brighter) and gets a white ring 4 px off the pill, on top of the scale-up. */
export const primaryFocus = { backgroundColor: '#3df57f', outlineColor: '#fff', outlineWidth: 3, outlineOffset: 4, outlineStyle: 'solid' } as const;
export const FOCUS_SCALE = 1.06;
export const FOCUS_MS = 150;
export const UNFOCUSED_OPACITY = 0.9;
/** 3 px white ring for focused cards/tiles (apply as `focusedStyle`; the item needs a transparent 3 px border). */
export const ring = { borderColor: tv.focus } as const;

/**
 * A D-pad focusable: scales to 1.06 in 150 ms with a soft shadow while focused; unfocused items sit at 0.9 opacity.
 * `children` may be a function of the focus state. `focusedStyle` adds the ring/fill.
 */
export function Focusable({
  onPress,
  onFocus,
  onBlur,
  children,
  style,
  focusedStyle,
  scale = FOCUS_SCALE,
  preferred,
  label,
  disabled,
  dim = true,
  wrapStyle,
  zone = 'content',
  layer,
}: {
  onPress?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  children: ReactNode | ((focused: boolean) => ReactNode);
  style?: StyleProp<ViewStyle>;
  focusedStyle?: StyleProp<ViewStyle>;
  scale?: number;
  preferred?: boolean;
  label?: string;
  /** Not focusable (e.g. a control row sitting under an open panel). */
  disabled?: boolean;
  /** Unfocused items sit at 0.9 opacity (default). */
  dim?: boolean;
  /** Style of the outer focusable wrapper (e.g. `flex: 1` to fill a parent). */
  wrapStyle?: StyleProp<ViewStyle>;
  /** Which part of the screen this is, for the focus log in perf mode. */
  zone?: 'rail' | 'content';
  /** Draw the item as one cached hardware texture: scrolling and the focus scale then move a bitmap instead of redrawing its views. */
  layer?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [grab, setGrab] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  // One native-driven value (0 = rest, 1 = focused) drives both the scale and the opacity.
  const [p] = useState(() => new Animated.Value(0));
  const scaleV = useMemo(() => p.interpolate({ inputRange: [0, 1], outputRange: [1, scale] }), [p, scale]);
  const opacityV = useMemo(() => (dim ? p.interpolate({ inputRange: [0, 1], outputRange: [UNFOCUSED_OPACITY, 1] }) : 1), [p, dim]);
  const mounted = useRef(false);
  useEffect(() => {
    // Nothing to animate on mount (rest state); skipping it saves two native animations per card when a grid appears.
    if (!mounted.current) {
      mounted.current = true;
      if (!focused) return;
    }
    Animated.timing(p, { toValue: focused ? 1 : 0, duration: FOCUS_MS, useNativeDriver: true }).start();
  }, [focused, p]);
  return (
    <Pressable
      style={wrapStyle}
      focusable={!disabled}
      accessible={!disabled}
      hasTVPreferredFocus={preferred || grab}
      onPress={() => {
        markActivity();
        onPress?.();
      }}
      onFocus={() => {
        markActivity();
        if (perfOn()) perfFocus(zone, label);
        if (zone === 'content')
          lastContent = {
            claim: () => {
              if (!alive.current) return false;
              setGrab(true);
              return true;
            },
            release: () => alive.current && setGrab(false),
          };
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur?.();
      }}
      accessibilityLabel={label}
      accessibilityRole="button">
      <Animated.View renderToHardwareTextureAndroid={layer} style={[style, { transform: [{ scale: scaleV }], opacity: opacityV }, focused && s_shadow, focused && focusedStyle]}>
        {typeof children === 'function' ? children(focused) : children}
      </Animated.View>
    </Pressable>
  );
}

export function Button({ label, icon, onPress, primary, preferred }: { label?: string; icon?: IconName; onPress: () => void; primary?: boolean; preferred?: boolean }) {
  return (
    <Focusable onPress={onPress} preferred={preferred} label={label} style={[s.btn, primary && s.btnPrimary]} focusedStyle={primary ? primaryFocus : s.btnFocus} scale={1.05}>
      {(f) => (
        <>
          {icon ? <Icon name={icon} size={30} color={primary && !f ? '#000' : f ? '#000' : '#fff'} /> : null}
          {label ? <Text style={[s.btnText, (f || primary) && { color: '#000' }]}>{label}</Text> : null}
        </>
      )}
    </Focusable>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={s.sectionTitle}>{children}</Text>;
}

export const CARD_GAP = 24;

/** The card is the song already loaded: open Now Playing (resuming it if paused) and never restart it from 0. Returns true when handled. */
export function openIfCurrent(id: string): boolean {
  const s = playerState();
  const act = pressAction({ currentId: s.queue[s.index]?.id, status: s.status }, id);
  if (act === 'play') return false;
  if (act === 'resume') void togglePlay();
  tvNav().push({ name: 'now' });
  return true;
}

/** What pressing a card does: tracks play the surrounding row as a queue; everything else opens its page. */
export function activate(item: MusicItem, siblings?: MusicItem[], source = 'tv'): void {
  if (item.kind === 'track') {
    if (openIfCurrent(item.id)) return;
    const tracks = (siblings ?? [item]).filter((i): i is Track => i.kind === 'track');
    void playTracks(tracks, Math.max(0, tracks.findIndex((t) => t.id === item.id)), { source });
    tvNav().push({ name: 'now' });
  } else if (item.kind === 'album') tvNav().push({ name: 'album', id: item.id });
  else if (item.kind === 'artist') tvNav().push({ name: 'artist', id: item.id });
  else tvNav().push({ name: 'playlist', id: item.id });
}

/** How a card is labelled: the title under every card (subtitle on focus), or nothing until it is focused. */
export const CARD_LABELS: 'always' | 'focus' = 'focus';

export function Card({ item, onPress, onFocus, preferred, width = tv.card }: { item: MusicItem; onPress: () => void; onFocus?: () => void; preferred?: boolean; width?: number }) {
  const sub = itemSubtitle(item);
  const round = item.kind === 'artist';
  useEffect(() => (perfEnd('nav', 'first card'), perfEnd('tab', 'first card'), perfEnd('launch', 'first card')), []);
  return (
    <Focusable
      onPress={onPress}
      onFocus={() => {
        setBackdrop(pickArtwork(item.artwork, 320));
        onFocus?.();
      }}
      preferred={preferred}
      label={itemTitle(item)}
      layer
      style={{ width }}
      scale={1.06}>
      {(f) => (
        <>
          <View style={[s.cardArt, { width, height: width, borderRadius: round ? width / 2 : 12 }, f && s.cardArtFocus]}>
            <Artwork art={item.artwork} size={width} round={round} style={{ borderRadius: round ? width / 2 : 9 }} />
          </View>
          <View style={s.cardLabel}>
            {CARD_LABELS === 'always' || f ? (
              <Text style={[s.cardTitle, f && { color: '#fff' }]} numberOfLines={1}>
                {itemTitle(item)}
              </Text>
            ) : null}
            {f && sub ? (
              <Text style={s.cardSub} numberOfLines={1}>
                {sub}
              </Text>
            ) : null}
          </View>
        </>
      )}
    </Focusable>
  );
}

/** The last focused item per screen, so coming back (Back from Now Playing, a detail page...) lands where the user left. */
const focusMemory = new Map<string, string>();
export const rememberFocus = (screen: string, id: string) => void focusMemory.set(screen, id);
export const recallFocus = (screen: string): string | undefined => focusMemory.get(screen);

/** The remembered focus id for a screen, only for the first moments after it mounts (so it never pulls focus back later). */
export function useRestoreOnce(screen: string): string | undefined {
  const [v, setV] = useState<string | undefined>(() => recallFocus(screen));
  useEffect(() => {
    const id = setTimeout(() => setV(undefined), 700);
    return () => clearTimeout(id);
  }, []);
  return v;
}

/** Home backdrop source: the focused card's artwork. The previous one stays underneath while the new one fades in. */
export const useBackdrop = create<{ current?: string; previous?: string }>(() => ({}));
export function setBackdrop(uri: string | undefined): void {
  const cur = useBackdrop.getState().current;
  if (uri && uri !== cur) useBackdrop.setState({ previous: cur, current: uri });
}

// Which row focus was in last, so entering a row from above/below can land on its remembered card.
let lastRow = '';
const remembered = new Map<string, number>();

/** Horizontal row of cards. Remembers the focused card per row and scrolls to keep it in view. */
export function Row({ id, title, items, source = 'tv', width = tv.card, preferFirst, screen, onRowFocus }: { id: string; title: string; items: MusicItem[]; source?: string; width?: number; preferFirst?: boolean; screen?: string; onRowFocus?: () => void }) {
  const list = useRef<FlatList<MusicItem>>(null);
  const r = useRestoreOnce(screen ?? '');
  const restoreIdx = r?.startsWith(`${id}:`) ? Number(r.slice(id.length + 1)) : undefined;
  const [pref, setPref] = useState<number | undefined>(undefined);
  const prefIdx = pref ?? restoreIdx;
  const onFocus = useCallback(
    (i: number) => {
      if (screen) rememberFocus(screen, `${id}:${i}`);
      onRowFocus?.();
      const mem = remembered.get(id);
      const entering = lastRow !== id;
      lastRow = id;
      if (entering && mem !== undefined && mem !== i && mem < items.length) {
        setPref(mem);
        return;
      }
      setPref(undefined);
      remembered.set(id, i);
      list.current?.scrollToOffset({ offset: Math.max(0, (i - 1) * (width + CARD_GAP)), animated: true });
    },
    [id, items.length, width, screen, onRowFocus],
  );
  const shown = items.slice(0, 12);
  if (!shown.length) return null;
  return (
    <View style={s.row}>
      <SectionTitle>{title}</SectionTitle>
      <FlatList
        ref={list}
        horizontal
        data={shown}
        keyExtractor={(it, i) => `${it.kind}-${it.id}-${i}`}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={12}
        windowSize={11}
        contentContainerStyle={s.rowContent}
        ItemSeparatorComponent={Gap}
        renderItem={({ item, index }) => <Card item={item} width={width} preferred={prefIdx === index || (preferFirst && index === 0 && prefIdx === undefined && !r)} onFocus={() => onFocus(index)} onPress={() => activate(item, shown, source)} />}
      />
    </View>
  );
}

/** The tile's art once it has kept focus: needs the whole mood page (a big fetch + parse), so only a dwelled-on tile mounts this. */
function MoodArt({ params, size }: { params: string; size: number }) {
  const page = useMoodPage(params, true);
  const art = page.data?.flatMap((sh) => sh.items).find((i) => 'artwork' in i && i.artwork.length > 0);
  const url = art && 'artwork' in art ? pickArtwork(art.artwork, 240) : undefined;
  return url ? <Image source={{ uri: url }} style={[s.moodArt, { width: size, height: size, right: -size * 0.18, bottom: -size * 0.13 }]} contentFit="cover" /> : null;
}

/** The tile's static backdrop (colour and blobs). One hardware texture: the paths are rasterised once instead of on every frame of the focus animation. */
const MoodBg = memo(function MoodBg({ title, color }: { title: string; color: string }) {
  const shapes = useMemo(() => tileShapes(title, color), [title, color]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" renderToHardwareTextureAndroid>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 80" preserveAspectRatio="xMidYMid slice">
        {shapes.map((sh, i) => (
          <Path key={i} d={sh.d} fill={sh.fill} fillOpacity={sh.opacity} />
        ))}
      </Svg>
    </View>
  );
});

/** Colour tile for a mood or genre; opens its browse page. Same look as the phone's: tinted blobs, an icon, bold title and a tilted artwork peeking from the corner. */
export const MoodTile = memo(function MoodTile({ mood, width, height = Math.round(width / 1.6), onFocus, preferred, disabled }: { mood: Mood; width: number; height?: number; onFocus?: () => void; preferred?: boolean; disabled?: boolean }) {
  const color = tileColor(mood.title, mood.color);
  // The corner artwork is loaded only after the tile has kept focus briefly (loading it for every tile on screen pegged the JS thread).
  // A tile whose page is already cached shows its art at once (a plain cache read, no query observer per tile).
  const [want, setWant] = useState(() => !!mood.params && queryClient.getQueryData(['yt', 'mood', mood.params]) !== undefined);
  const dwell = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(dwell.current), []);
  useEffect(() => (perfEnd('nav', 'first mood tile'), perfEnd('tab', 'first mood tile')), []);
  const artSize = Math.round(height * 0.62);
  return (
    <Focusable
      onPress={() => (mood.params ? tvNav().push({ name: 'mood', params: mood.params, title: mood.title }) : undefined)}
      onFocus={() => {
        onFocus?.();
        clearTimeout(dwell.current);
        if (!want) dwell.current = setTimeout(() => setWant(true), 600);
      }}
      onBlur={() => clearTimeout(dwell.current)}
      preferred={preferred}
      disabled={disabled}
      label={mood.title}
      layer
      style={[s.mood, { width, height, backgroundColor: color }]}
      focusedStyle={s.moodOn}
      scale={1.06}>
      <MoodBg title={mood.title} color={color} />
      <Icon name={tvMoodIcon(moodIcon(mood.title))} size={26} color="rgba(255,255,255,0.85)" />
      <Text style={s.moodText} numberOfLines={2}>
        {mood.title}
      </Text>
      {want && mood.params ? <MoodArt params={mood.params} size={artSize} /> : null}
    </Focusable>
  );
});

const Gap = () => <View style={{ width: CARD_GAP }} />;

export function Centered({ children }: { children: ReactNode }) {
  return <View style={s.centered}>{children}</View>;
}

export const BodyText = ({ children }: { children: ReactNode }) => <Text style={s.body}>{children}</Text>;

// No elevation: an Android elevation shadow is recomputed on every frame of the focus animation, on every card.
const s_shadow = { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } } as const;

const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 60, paddingHorizontal: 28, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.14)' },
  btnPrimary: { backgroundColor: tv.accent },
  btnFocus: { backgroundColor: '#fff' },
  btnText: { color: '#fff', fontFamily: tv.font.bold, fontSize: 22 },
  sectionTitle: { color: tv.text, fontFamily: tv.font.bold, fontSize: 28, marginLeft: tv.gutter, marginBottom: 2 },
  row: { marginTop: 6, marginBottom: 14 },
  rowContent: { paddingHorizontal: tv.gutter, paddingVertical: 18 },
  cardArt: { borderWidth: 3, borderColor: 'transparent', overflow: 'hidden', backgroundColor: tv.surface },
  cardArtFocus: { borderColor: tv.focus },
  cardLabel: { height: 54, marginTop: 10 },
  cardTitle: { color: '#d8d8de', fontFamily: tv.font.bold, fontSize: 22 },
  cardSub: { color: tv.textDim, fontFamily: tv.font.regular, fontSize: 18, marginTop: 2 },
  mood: { borderRadius: 14, padding: 18, justifyContent: 'space-between', borderWidth: 3, borderColor: 'transparent', overflow: 'hidden' },
  moodArt: { position: 'absolute', borderRadius: 8, transform: [{ rotate: '25deg' }] },
  moodOn: { borderColor: '#fff' },
  moodText: { color: '#fff', fontFamily: tv.font.extraBold, fontSize: 26, lineHeight: 30, maxWidth: '72%' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { color: tv.textDim, fontFamily: tv.font.regular, fontSize: 22 },
});
