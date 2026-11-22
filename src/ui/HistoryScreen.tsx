import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native-unistyles';

import { PerfProfiler } from '../util/PerfProfiler';
import { getHistory, onHistoryChange } from '../player/history';
import { playSong } from './playSong';
import { Header, Screen, useScreenTop } from './Layout';
import { AnimatedFlashList, useScrollY } from './scroll';
import { EmptyState } from './States';
import { TrackRow } from './TrackRow';
import type { Track } from '../youtube/models';

/** Recently played songs, newest first (the last 50). */
export function HistoryScreen() {
  const { scrollY, onScroll } = useScrollY();
  const topInset = useScreenTop('header');
  const [tracks, setTracks] = useState<Track[]>(() => getHistory());
  useEffect(() => onHistoryChange(() => setTracks(getHistory())), []);
  return (
    <Screen top="header" mini>
      <PerfProfiler id="phone-history">
      <AnimatedFlashList
        data={tracks}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: topInset }]}
        keyExtractor={(t: Track) => t.id}
        ListEmptyComponent={<EmptyState art="rows" icon="clock" title="Nothing played yet" body="Songs you play show up here." action={{ label: 'Go to Home', kind: 'secondary', onPress: () => router.navigate('/') }} />}
        renderItem={({ item, index }: { item: Track; index: number }) => <TrackRow track={item} onPress={() => playSong(tracks, index, { source: 'history' })} />}
      />
      </PerfProfiler>
      <Header title="History" scrollY={scrollY} back inline />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { paddingBottom: theme.spacing.xxl },
}));
