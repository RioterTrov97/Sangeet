import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useMoodPage } from '../youtube/queries';
import { Header, Screen, useScreenTop } from './Layout';
import { AnimatedFlashList, useScrollY } from './scroll';
import { Shelf } from './Shelf';
import { EmptyState, ErrorState, Skeleton } from './States';

/** A YT Music mood/genre browse page (`browse` with params), as a stack of shelves. */
export function MoodScreen() {
  const { params, title } = useLocalSearchParams<{ params?: string; title?: string }>();
  const { data, isLoading, isError, refetch } = useMoodPage(params);
  const { scrollY, onScroll } = useScrollY();
  const topInset = useScreenTop('header');
  return (
    <Screen top="header" mini>
      <AnimatedFlashList
        data={data ?? []}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: topInset }]}
        keyExtractor={(s: { title: string }, i: number) => `${s.title}-${i}`}
        ListEmptyComponent={isLoading ? <View style={styles.pad}><Skeleton height={160} /></View> : isError ? <ErrorState message="Could not load this page" onRetry={() => void refetch()} /> : <EmptyState icon="music.note" title="Nothing here" body="This page has no music right now." />}
        renderItem={({ item }: { item: { title: string; items: import('../youtube/models').MusicItem[] } }) => <Shelf title={item.title} items={item.items} source="mood" />}
      />
      <Header title={title ?? 'Browse'} scrollY={scrollY} back inline />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { paddingBottom: theme.spacing.xxl },
  pad: { paddingHorizontal: theme.spacing.lg },
}));
