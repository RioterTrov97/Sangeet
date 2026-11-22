import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native-unistyles';

import { PerfProfiler } from '../util/PerfProfiler';
import { useAuth } from '../auth/store';
import { getHistory, mergeHistory, onHistoryChange } from '../player/history';
import { playSong } from './playSong';
import { View } from 'react-native';
import { Header, Screen, useScreenTop } from './Layout';
import { AnimatedFlashList, useScrollY } from './scroll';
import { useYtHistory } from '../youtube/queries';
import { Chip } from './Controls';
import { EmptyState } from './States';
import { TrackRow } from './TrackRow';
import type { Track } from '../youtube/models';

/** Recently played songs, newest first (the last 50). Signed in: all devices (default) or this phone. */
export function HistoryScreen() {
  const { scrollY, onScroll } = useScrollY();
  const topInset = useScreenTop('header');
  const [local, setLocal] = useState<Track[]>(() => getHistory());
  useEffect(() => onHistoryChange(() => setLocal(getHistory())), []);
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const [scope, setScope] = useState<'all' | 'phone'>('all');
  const remote = useYtHistory().data;
  const merged = useMemo(() => (signedIn && scope === 'all' && remote?.length ? mergeHistory(local, remote) : local), [signedIn, scope, local, remote]);
  const tracks = merged;
  return (
    <Screen top="header" mini>
      <PerfProfiler id="phone-history">
      <AnimatedFlashList
        data={tracks}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={signedIn ? (
          <View style={styles.chips}>
            <Chip label="All devices" selected={scope === 'all'} onPress={() => setScope('all')} />
            <Chip label="This phone" selected={scope === 'phone'} onPress={() => setScope('phone')} />
          </View>
        ) : null}
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
  chips: { flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md },
  content: { paddingBottom: theme.spacing.xxl },
}));
