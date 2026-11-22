import { DlMark } from './DlMark';
import { SymbolView } from 'expo-symbols';
import { usePalette } from './palette/store';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { clearUpcoming, moveInQueue, removeFromQueue, skipToIndex, useNowPlaying, usePlayerStore, useQueue } from '../player';
import type { Track } from '../youtube/models';
import { Artwork } from './Artwork';
import { Equalizer } from './Equalizer';

type Row = { type: 'header'; key: string; title: string } | { type: 'track'; key: string; track: Track; pos: number };

export function sourceLabel(source?: string, name?: string): string {
  if (name) return name;
  if (!source) return 'your queue';
  const kind = source.split(':')[0];
  return { search: 'Search', home: 'Home', recents: 'Recently played', liked: 'Liked Songs', radio: 'Radio', carplay: 'CarPlay' }[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Sections of the queue after the current track: user-added first, then the rest of the source. */
export function buildQueueRows(queue: Track[], index: number, userAdded: string[], source?: string, sourceName?: string): Row[] {
  const upcoming = queue.slice(index + 1).map((track, i) => ({ track, pos: index + 1 + i }));
  const added = upcoming.filter((u) => userAdded.includes(u.track.id));
  const rest = upcoming.filter((u) => !userAdded.includes(u.track.id));
  const rows: Row[] = [];
  if (added.length) rows.push({ type: 'header', key: 'h-added', title: 'Next in queue' }, ...added.map((u) => ({ type: 'track' as const, key: u.track.id, ...u })));
  if (rest.length) rows.push({ type: 'header', key: 'h-rest', title: `Next from: ${sourceLabel(source, sourceName)}` }, ...rest.map((u) => ({ type: 'track' as const, key: u.track.id, ...u })));
  return rows;
}

/**
 * The queue, presented as a native iOS form sheet over the player (route /queue). It was a JS bottom sheet inside the player's
 * native modal, where the sheet's gestures took half of every drag and a drag near the bottom closed it: the list never
 * reached its end. A native sheet scrolls and dismisses like any other.
 */
export function QueueScreen() {
  const { queue, index } = useQueue();
  const { isPlaying } = useNowPlaying();
  const userAdded = usePlayerStore((s) => s.userAdded);
  const source = usePlayerStore((s) => s.source);
  const sourceName = usePlayerStore((s) => s.sourceName);
  const { theme } = useUnistyles();
  const palette = usePalette();
  const rows = useMemo(() => buildQueueRows(queue, index, userAdded, source, sourceName), [queue, index, userAdded, source, sourceName]);
  const current = queue[index];
  const insets = useSafeAreaInsets();

  const renderItem = ({ item, drag, isActive }: RenderItemParams<Row>) => {
    if (item.type === 'header') return <Text style={styles.section}>{item.title}</Text>;
    const t = item.track;
    return (
      <ScaleDecorator>
        <ReanimatedSwipeable
          overshootRight={false}
          renderRightActions={() => (
            <View style={styles.remove} accessibilityElementsHidden>
              <SymbolView name="trash" size={18} tintColor="#fff" />
            </View>
          )}
          onSwipeableOpen={() => void removeFromQueue(item.pos)}>
          <Pressable onPress={() => {
              void skipToIndex(item.pos);
              router.back();
            }} onLongPress={drag} delayLongPress={200} disabled={isActive} style={[styles.row, isActive && styles.dragging]} accessibilityRole="button" accessibilityLabel={`${t.title}, ${t.artists.map((a) => a.name).join(', ')}. Swipe left to remove`}>
            <Artwork art={t.artwork} size={40} />
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>
                {t.title}
              </Text>
              <View style={styles.subRow}>
                <DlMark id={t.id} />
                <Text style={[styles.artist, styles.artistText]} numberOfLines={1}>
                  {t.artists.map((a) => a.name).join(', ')}
                </Text>
              </View>
            </View>
            <Pressable hitSlop={10} onPressIn={drag} accessibilityRole="button" accessibilityLabel="Reorder">
              <SymbolView name="line.3.horizontal" tintColor={theme.colors.textSecondary} size={18} />
            </Pressable>
          </Pressable>
        </ReanimatedSwipeable>
      </ScaleDecorator>
    );
  };

  return (
    <GestureHandlerRootView style={[styles.sheet, { backgroundColor: palette.bgDeep }]}>
        <View style={styles.header}>
          <Text style={styles.heading} accessibilityRole="header">
            Queue
          </Text>
          <Pressable onPress={() => void clearUpcoming()} accessibilityRole="button" accessibilityLabel="Clear upcoming">
            <Text style={styles.clear}>Clear queue</Text>
          </Pressable>
        </View>
        <DraggableFlatList
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={renderItem}
          containerStyle={styles.list}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={
            current ? (
              <View>
                <Text style={styles.section}>Now playing</Text>
                <View style={styles.row}>
                  <Artwork art={current.artwork} size={40} />
                  <View style={styles.text}>
                    <Text style={[styles.title, styles.current]} numberOfLines={1}>
                      {current.title}
                    </Text>
                    <Text style={styles.artist} numberOfLines={1}>
                      {current.artists.map((a) => a.name).join(', ')}
                    </Text>
                  </View>
                  <Equalizer playing={isPlaying} />
                </View>
              </View>
            ) : undefined
          }
          onDragEnd={({ from, to }) => {
            const tracks = rows.filter((r): r is Extract<Row, { type: 'track' }> => r.type === 'track');
            const src = rows[from];
            const dst = rows[to];
            if (src?.type !== 'track') return;
            const target = dst?.type === 'track' ? dst.pos : to > from ? tracks[tracks.length - 1].pos : tracks[0].pos;
            if (target !== src.pos) void moveInQueue(src.pos, target);
          }}
        />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create((theme) => ({
  sheet: { flex: 1, paddingTop: theme.spacing.xl },
  list: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm },
  heading: { color: theme.colors.text, ...theme.typography.title },
  clear: { color: theme.colors.accent, ...theme.typography.body },
  section: { color: theme.colors.textSecondary, ...theme.typography.heading, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg, paddingBottom: theme.spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm, backgroundColor: theme.colors.surface },
  dragging: { backgroundColor: theme.colors.surfaceElevated },
  remove: { width: 72, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.error },
  text: { flex: 1 },
  title: { color: theme.colors.text, ...theme.typography.body },
  current: { color: theme.colors.accent },
  artist: { color: theme.colors.textSecondary, ...theme.typography.caption },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  artistText: { flexShrink: 1 },
}));
