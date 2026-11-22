import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Icon } from './Icon';
import { useEffect, useState } from 'react';
import { Pressable, Share, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

import { toggleFollow, useIsFollowing } from '../library/store';
import { playTracks } from '../player';
import { channelIdOf } from '../youtube/api';
import { pickArtwork } from '../youtube/mappers/common';
import type { Track } from '../youtube/models';
import { useArtist } from '../youtube/queries';
import { PlayButton } from './Controls';
import { Glass } from './Glass';
import { Header, Screen, SectionTitle } from './Layout';
import { tap } from './haptic';
import { useArtworkPalette } from './palette/useArtworkPalette';
import { AnimatedFlashList, useScrollY } from './scroll';
import { openActionSheet } from './sheet';
import { playSong } from './playSong';
import { Shelf } from './Shelf';
import { ErrorState, Skeleton } from './States';
import { TrackRow } from './TrackRow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const POPULAR = 5;
const PAGE_BG = '#121212';

/** `?play=all|shuffle` lets simulator verification start playback via deep link. */
function useAutoPlay(tracks: Track[], source: string) {
  const { play } = useLocalSearchParams<{ play?: string }>();
  useEffect(() => {
    if (!play || !tracks.length) return;
    if (play === 'all') void playTracks(tracks, 0, { source });
    else if (play === 'shuffle') void playTracks(tracks, 0, { source, shuffle: true });
  }, [play, tracks.length]); // eslint-disable-line react-hooks/exhaustive-deps
}

function BackButton() {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.navigate('/'))}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={[styles.back, { top: insets.top + 4 }]}>
      <Glass radius={20} tint="rgba(0,0,0,0.38)" intensity={30} style={styles.backGlass}>
        <Icon name="chevron.left" size={18} tintColor="#fff" />
      </Glass>
    </Pressable>
  );
}

type Row = { t: 'song'; track: Track; i: number } | { t: 'more' } | { t: 'shelf'; title: string; items: any[] };

export function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isError, refetch } = useArtist(id);
  const { scrollY, onScroll } = useScrollY();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [all, setAll] = useState(false);
  const following = useIsFollowing(id);
  const pal = useArtworkPalette(data ? `artist:${id}` : undefined, data?.artist.artwork);
  useAutoPlay(data?.topSongs ?? [], `artist:${id}`);
  const heroH = Math.round(height * 0.45);
  const bg = pal?.bg ?? PAGE_BG;
  const accent = pal?.accent ?? '#1ed760';
  const onAccent = pal?.onAccent ?? '#000000';

  const heroStyle = useAnimatedStyle(() => {
    const s = scrollY.value;
    const scale = 1 + Math.max(0, -s) / heroH; // overscroll: stretch, pinned to the top
    return {
      opacity: interpolate(s, [heroH * 0.3, heroH * 0.85], [1, 0], Extrapolation.CLAMP),
      transform: [{ translateY: s > 0 ? -s * 0.45 : ((scale - 1) * heroH) / 2 }, { scale }],
    };
  });
  const nameStyle = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [heroH * 0.35, heroH * 0.7], [1, 0], Extrapolation.CLAMP) }));

  if (!data) {
    return (
      <Screen top="none" mini>
        <BackButton />
        {isError ? (
          <View style={styles.center}>
            <ErrorState message="Could not load" onRetry={() => void refetch()} />
          </View>
        ) : (
          <View style={styles.skel}>
            <Skeleton width="100%" height={heroH} radius={0} />
            <Skeleton width="50%" height={26} />
          </View>
        )}
      </Screen>
    );
  }

  const artist = { ...data.artist, ...(data.artist.channelId ? {} : { channelId: channelIdOf(data.artist) }) };
  const popular = all ? data.topSongs : data.topSongs.slice(0, POPULAR);
  const rows: Row[] = [
    ...popular.map((track, i) => ({ t: 'song' as const, track, i })),
    ...(data.topSongs.length > POPULAR ? [{ t: 'more' as const }] : []),
    ...(data.albums.length ? [{ t: 'shelf' as const, title: 'Albums', items: data.albums }] : []),
    ...(data.singles.length ? [{ t: 'shelf' as const, title: 'Singles & EPs', items: data.singles }] : []),
    ...data.shelves.filter((s) => s.items.length).map((s) => ({ t: 'shelf' as const, title: s.title, items: s.items })),
    ...(data.related.length ? [{ t: 'shelf' as const, title: 'Fans also like', items: data.related }] : []),
  ];
  const src = `artist:${id}`;
  const openMenu = () =>
    openActionSheet({
      header: { title: data.artist.name, subtitle: 'Artist', art: data.artist.artwork, round: true },
      actions: [
        { id: 'follow', label: following ? 'Unfollow' : 'Follow', icon: following ? 'person.badge.minus' : 'person.badge.plus', onPress: () => void toggleFollow(artist) },
        { id: 'share', label: 'Share', icon: 'square.and.arrow.up', onPress: () => void Share.share({ message: `https://music.youtube.com/channel/${artist.channelId ?? id}` }) },
      ],
    });
  const art = pickArtwork(data.artist.artwork, 1200);

  return (
    <Screen top="none" mini style={{ backgroundColor: bg }}>
      <Animated.View style={[styles.heroImg, { width, height: heroH }, heroStyle]} pointerEvents="none">
        <Image source={art ? { uri: art } : undefined} style={{ width, height: heroH, backgroundColor: '#282828' }} contentFit="cover" contentPosition="top" transition={150} accessible={false} />
        <LinearGradient colors={[`${bg}00`, `${bg}aa`, bg]} locations={[0.35, 0.75, 1]} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)']} style={[styles.topShade, { height: insets.top + 60 }]} />
      </Animated.View>
      <AnimatedFlashList
        data={rows}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyExtractor={(r: Row, i: number) => (r.t === 'song' ? `s-${r.track.id}` : r.t === 'shelf' ? `h-${r.title}` : `m-${i}`)}
        getItemType={(r: Row) => r.t}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <View style={{ height: heroH, justifyContent: 'flex-end' }}>
              <Animated.Text style={[styles.artistName, nameStyle]} numberOfLines={2} accessibilityRole="header">
                {data.artist.name}
              </Animated.Text>
            </View>
            <View style={styles.actions}>
              <View style={styles.actionsLeft}>
                <Pressable
                  onPress={() => {
                    tap();
                    toggleFollow(artist);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: following }}
                  accessibilityLabel={following ? 'Following, tap to unfollow' : 'Follow'}
                  style={[styles.follow, following ? { backgroundColor: accent, borderColor: accent } : null]}>
                  <Text style={[styles.followText, following ? { color: onAccent } : null]}>{following ? 'Following' : 'Follow'}</Text>
                </Pressable>
                <Pressable onPress={openMenu} accessibilityRole="button" accessibilityLabel="More options" style={styles.dots}>
                  <Icon name="ellipsis" size={22} tintColor="#fff" />
                </Pressable>
              </View>
              <View style={styles.actionsRight}>
                <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel="Shuffle" onPress={() => { tap(); void playTracks(data.topSongs, 0, { source: src, shuffle: true }); }}>
                  <Icon name="shuffle" size={24} tintColor="#fff" />
                </Pressable>
                <PlayButton size={58} label="Play" fill={accent} iconColor={onAccent} onPress={() => { tap(); void playTracks(data.topSongs, 0, { source: src }); }} />
              </View>
            </View>
            {data.topSongs.length ? <SectionTitle title="Popular" /> : null}
          </View>
        }
        renderItem={({ item }: { item: Row }) =>
          item.t === 'song' ? (
            <TrackRow track={item.track} index={item.i} onPress={() => playSong(data.topSongs, item.i, { source: src })} />
          ) : item.t === 'more' ? (
            <Text style={styles.showMore} onPress={() => setAll(!all)} accessibilityRole="button">
              {all ? 'Show less' : 'Show more'}
            </Text>
          ) : (
            <Shelf title={item.title} items={item.items} source={src} size={item.title === 'Fans also like' ? 120 : 140} />
          )
        }
        ListFooterComponent={<View style={styles.footer} />}
      />
      <Header title={data.artist.name} scrollY={scrollY} threshold={heroH - insets.top - 64} titleInset={44} />
      <BackButton />
    </Screen>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  skel: { flex: 1, gap: theme.spacing.md },
  heroImg: { position: 'absolute', top: 0, left: 0 },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0 },
  back: { position: 'absolute', left: theme.spacing.lg, zIndex: 20 },
  backGlass: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: theme.spacing.xl },
  artistName: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md, color: '#fff', ...theme.typography.display, fontSize: 44, lineHeight: 50, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.lg },
  actionsLeft: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  actionsRight: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xl },
  follow: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' },
  followText: { color: '#fff', ...theme.typography.heading, fontSize: 14, lineHeight: 18 },
  dots: { padding: theme.spacing.sm },
  showMore: { color: theme.colors.textSecondary, ...theme.typography.heading, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md },
  footer: { height: theme.spacing.xl },
}));
