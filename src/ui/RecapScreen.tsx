import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { logWarn } from '../util/log';
import { playTracks } from '../player';
import { getRecapTracks } from '../youtube/api';
import type { Shelf as ShelfModel } from '../youtube/models';
import { useRecap } from '../youtube/queries';
import { Header, Screen, useScreenTop } from './Layout';
import { Icon } from './Icon';
import { AnimatedFlashList, useScrollY } from './scroll';
import { Shelf } from './Shelf';
import { EmptyState, ErrorState, Skeleton } from './States';

/** The YouTube Music Recap (signed in): a play button for the Recap playlist, then its shelves. */
export function RecapScreen() {
  const { data, isLoading, isError, refetch } = useRecap();
  const { scrollY, onScroll } = useScrollY();
  const topInset = useScreenTop('header');
  const [busy, setBusy] = useState(false);
  const play = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const tracks = await getRecapTracks();
      if (tracks.length) await playTracks(tracks, 0, { source: 'recap' });
    } catch (e) {
      logWarn('recap', 'play failed', e instanceof Error ? e.message : e);
    } finally {
      setBusy(false);
    }
  };
  const head = data ? (
    <View style={styles.head}>
      {data.subtitle ? <Text style={styles.sub}>{data.subtitle}</Text> : null}
      <Pressable onPress={() => void play()} style={styles.play} accessibilityRole="button" accessibilityLabel="Play your Recap">
        <Icon name="play.fill" size={16} tintColor="#000" />
        <Text style={styles.playText}>{busy ? 'Loading…' : 'Play your Recap'}</Text>
      </Pressable>
    </View>
  ) : null;
  return (
    <Screen top="header" mini>
      <AnimatedFlashList
        data={data?.shelves ?? []}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: topInset }]}
        keyExtractor={(s: ShelfModel, i: number) => `${s.title}-${i}`}
        ListHeaderComponent={head}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.pad}>
              <Skeleton height={160} />
            </View>
          ) : isError ? (
            <ErrorState message="Could not load your Recap" onRetry={() => void refetch()} />
          ) : data ? null : (
            <EmptyState icon="sparkles" title="Recap isn't ready yet" body="Your Recap shows up once you have listened to enough music." />
          )
        }
        renderItem={({ item }: { item: ShelfModel }) => <Shelf title={item.title} items={item.items} source="recap" />}
      />
      <Header title={data?.title ?? 'Your Recap'} scrollY={scrollY} back inline />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { paddingBottom: theme.spacing.xxl },
  pad: { paddingHorizontal: theme.spacing.lg },
  head: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: theme.spacing.md, alignItems: 'flex-start' },
  sub: { color: theme.colors.textTertiary, ...theme.typography.body },
  play: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.xl, paddingVertical: 10, borderRadius: theme.radii.full, backgroundColor: theme.colors.text },
  playText: { color: '#000', ...theme.typography.heading },
}));
