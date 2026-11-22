import { createContext, memo, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '../player/format';
import { playTracks } from '../player';
import { usePlayerStore } from '../player/store';
import { Artwork } from '../ui/Artwork';
import { Equalizer } from '../ui/Equalizer';
import { usePalette } from '../ui/palette/store';
import { perfEnd } from '../util/perf';
import type { Track } from '../youtube/models';
import { Icon, type IconName } from './icons';
import { tvNav } from './nav';
import { useTvWindow } from './scale';
import { tv } from './theme';
import { Focusable, openIfCurrent, primaryFocus, ring } from './ui';

export const SAFE_X = tv.gutter;
export const SAFE_Y = 28;
export const GRID_GAP = 14;
export const CARD_H = 76;

/** Start playing `tracks` at `index` and open Now Playing. */
export function playAndOpen(tracks: Track[], index: number, source: string, name?: string, shuffle = false): void {
  if (!tracks.length) return;
  if (!shuffle && tracks[index] && openIfCurrent(tracks[index].id)) return;
  void playTracks(tracks, index, { source, sourceName: name, shuffle });
  tvNav().push({ name: 'now' });
}

/** The accent-coloured bits of the playing track's card; only the playing card subscribes to the palette. */
function PlayingMark({ playing, focused }: { playing: boolean; focused: boolean }) {
  const pal = usePalette();
  return <Equalizer playing={playing} color={focused ? '#fff' : pal.accent} />;
}
function PlayingTitle({ text, focused }: { text: string; focused: boolean }) {
  const pal = usePalette();
  return (
    <Text style={[st.title, !focused && { color: pal.accent }]} numberOfLines={1}>
      {text}
    </Text>
  );
}

/**
 * A compact track card: number (or the equalizer for the playing track), art, title, artist, duration.
 * Memoised and subscribed to one number (0 = not current, 1 = current, 2 = current and playing), so a play-state tick or a
 * palette change re-renders only the playing card, not the whole grid. `onPress` gets the card's index; keep it stable.
 */
export const TrackCard = memo(function TrackCard({ track, index, width, onPress, onFocus, preferred }: { track: Track; index: number; width: number; onPress: (index: number) => void; onFocus?: () => void; preferred?: boolean }) {
  const cur = usePlayerStore((s) => (s.queue[s.index]?.id !== track.id ? 0 : s.status === 'playing' || s.status === 'buffering' ? 2 : 1));
  useEffect(() => (perfEnd('nav', 'first track card'), perfEnd('tab', 'first track card')), []);
  const artists = useMemo(() => track.artists.map((a) => a.name).join(', '), [track]);
  return (
    <Focusable onPress={() => onPress(index)} onFocus={onFocus} preferred={preferred} label={track.title} layer style={[st.card, { width }]} focusedStyle={st.cardOn}>
      {(f) => (
        <>
          <View style={st.num}>{cur ? <PlayingMark playing={cur === 2} focused={f} /> : <Text style={st.numText}>{index + 1}</Text>}</View>
          <Artwork art={track.artwork} size={56} style={artStyle} />
          <View style={{ flex: 1, minWidth: 0 }}>
            {cur ? (
              <PlayingTitle text={track.title} focused={f} />
            ) : (
              <Text style={st.title} numberOfLines={1}>
                {track.title}
              </Text>
            )}
            <Text style={st.sub} numberOfLines={1}>
              {artists}
            </Text>
          </View>
          <Text style={st.dur}>{track.durationSec ? formatDuration(track.durationSec) : ''}</Text>
        </>
      )}
    </Focusable>
  );
});
const artStyle = { borderRadius: 6 } as const;

/** Content width available to a grid placed beside the rail and `left` dp of other columns. */
export function useGridWidth(left = 0): number {
  const { width } = useTvWindow();
  return Math.max(320, width - tv.rail - left - SAFE_X * 2);
}

/** A static (non-virtualised) two-column grid of track cards, for short lists inside scrolling pages. */
export function TrackGridStatic({ tracks, onPlay, columns = 2, width, startPreferred }: { tracks: Track[]; onPlay: (i: number) => void; columns?: number; width: number; startPreferred?: boolean }) {
  const cw = Math.floor((width - GRID_GAP * (columns - 1)) / columns);
  const rows = useMemo(() => {
    const r: number[][] = [];
    for (let i = 0; i < tracks.length; i += columns) r.push(Array.from({ length: Math.min(columns, tracks.length - i) }, (_, k) => i + k));
    return r;
  }, [tracks.length, columns]);
  return (
    <View style={{ width, gap: GRID_GAP }}>
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', gap: GRID_GAP }}>
          {row.map((i) => (
            <TrackCard key={`${tracks[i].id}-${i}`} track={tracks[i]} index={i} width={cw} preferred={startPreferred && i === 0} onPress={onPlay} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Pill button for the left column and hero bands: palette accent when primary, white fill when focused. */
export function ActionButton({ label, icon, onPress, onFocus, primary, preferred, width }: { label: string; icon: IconName; onPress: () => void; onFocus?: () => void; primary?: boolean; preferred?: boolean; width?: number }) {
  const half = useContext(HalfWidth);
  return (
    <Focusable onPress={onPress} onFocus={onFocus} preferred={preferred} label={label} scale={1.06} style={[st.btn, width ?? half ? { width: width ?? half } : null, { backgroundColor: primary ? tv.accent : 'rgba(255,255,255,0.14)' }]} focusedStyle={primary ? primaryFocus : { backgroundColor: '#fff' }}>
      {(f) => (
        <>
          <Icon name={icon} size={28} color={f || primary ? '#000' : '#fff'} />
          <Text style={[st.btnText, { color: f || primary ? '#000' : '#fff' }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Focusable>
  );
}

const HalfWidth = createContext<number | undefined>(undefined);

/** Two equal-width columns of ActionButtons. */
export function ButtonGrid({ children, width }: { children: ReactNode; width: number }) {
  return (
    <HalfWidth.Provider value={Math.floor((width - 10) / 2)}>
      <View style={{ width, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{children}</View>
    </HalfWidth.Provider>
  );
}

const st = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, height: CARD_H, paddingHorizontal: 12, borderRadius: 14, borderWidth: 3, borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.07)' },
  cardOn: { ...ring, backgroundColor: 'rgba(255,255,255,0.18)' },
  num: { width: 30, alignItems: 'center' },
  numText: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 20 },
  title: { color: '#fff', fontFamily: tv.font.bold, fontSize: 24 },
  sub: { color: tv.textDim, fontFamily: tv.font.regular, fontSize: 18, marginTop: 1 },
  dur: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 18 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 54, paddingHorizontal: 18, borderRadius: 27 },
  btnText: { fontFamily: tv.font.bold, fontSize: 21 },
});
