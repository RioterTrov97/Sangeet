import { Icon } from './Icon';
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useLocalTracks } from '../local';
import { importSongsFromFiles } from '../local/import';
import { playTracks } from '../player';
import type { Track } from '../youtube/models';
import { Header, Screen, useScreenTop } from './Layout';
import { playSong } from './playSong';
import { AnimatedFlashList, useScrollY } from './scroll';
import { EmptyState } from './States';
import { TrackRow } from './TrackRow';
import { DEVICE, EMPTY_BODY, ON_THIS_DEVICE } from '../local/wording';

type Row = { type: 'playbar' } | { type: 'import' } | { type: 'song'; track: Track };

const SOURCE = 'device';

/** Songs from this device: imported from Files (iPhone, also dropped into On My iPhone > Sangeet > Music) or picked with the document picker (Android). */
export function LocalSongsScreen() {
  const { scrollY, onScroll } = useScrollY();
  const topInset = useScreenTop('header');
  const songs = useLocalTracks();
  const rows = useMemo<Row[]>(() => (songs.length ? [{ type: 'playbar' }, { type: 'import' }, ...songs.map((track) => ({ type: 'song' as const, track }))] : []), [songs]);

  return (
    <Screen top="header" mini>
      <AnimatedFlashList
        data={rows}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: topInset }]}
        keyExtractor={(r: Row, i: number) => (r.type === 'song' ? r.track.id : `${r.type}-${i}`)}
        getItemType={(r: Row) => r.type}
        ListEmptyComponent={
          <EmptyState
            art="rows"
            icon="iphone"
            tone="downloads"
            title={`No songs from this ${DEVICE} yet`}
            body={EMPTY_BODY}
            action={{ label: 'Import songs', onPress: () => void importSongsFromFiles() }}
          />
        }
        renderItem={({ item: r }: { item: Row }) => {
          if (r.type === 'playbar')
            return (
              <View style={styles.playbar}>
                <Pressable style={[styles.bigPill, styles.bigPillOn]} onPress={() => void playTracks(songs, 0, { source: SOURCE, sourceName: ON_THIS_DEVICE })} accessibilityRole="button" accessibilityLabel="Play">
                  <Icon name="play.fill" size={16} tintColor="#000" />
                  <Text style={styles.bigPillOnText}>Play</Text>
                </Pressable>
                <Pressable style={styles.bigPill} onPress={() => void playTracks(songs, 0, { source: SOURCE, sourceName: ON_THIS_DEVICE, shuffle: true })} accessibilityRole="button" accessibilityLabel="Shuffle">
                  <Icon name="shuffle" size={16} tintColor="#fff" />
                  <Text style={styles.bigPillText}>Shuffle</Text>
                </Pressable>
              </View>
            );
          if (r.type === 'import')
            return (
              <Pressable style={styles.import} onPress={() => void importSongsFromFiles()} accessibilityRole="button" accessibilityLabel="Import songs">
                <Icon name="square.and.arrow.down" size={16} tintColor="#fff" />
                <Text style={styles.importText}>Import songs</Text>
              </Pressable>
            );
          return <TrackRow track={r.track} onPress={() => playSong(songs, Math.max(0, songs.findIndex((t) => t.id === r.track.id)), { source: SOURCE })} />;
        }}
      />
      <Header title={ON_THIS_DEVICE} scrollY={scrollY} back inline />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { paddingBottom: theme.spacing.xxl },
  playbar: { flexDirection: 'row', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm },
  bigPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, height: 44, borderRadius: 22, backgroundColor: theme.colors.surfaceElevated },
  bigPillOn: { backgroundColor: '#fff' },
  bigPillOnText: { color: '#000', ...theme.typography.heading },
  bigPillText: { color: theme.colors.text, ...theme.typography.heading },
  import: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: theme.spacing.sm, marginHorizontal: theme.spacing.lg, marginBottom: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, height: 40, borderRadius: 20, backgroundColor: theme.colors.surfaceElevated },
  importText: { color: theme.colors.text, ...theme.typography.body },
}));
