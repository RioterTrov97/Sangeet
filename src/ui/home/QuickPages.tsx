import { FlatList, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { MusicItem, Track } from '../../youtube/models';
import { itemSheet } from '../actions';
import { Artwork } from '../Artwork';
import { itemSubtitle, itemTitle } from '../itemText';
import { openItem } from '../nav';
import { playSong } from '../playSong';

const PER_PAGE = 4;

/** Signed-in Quick picks: pages of four track rows, the next page peeking in from the right (like YouTube Music). */
export function QuickPages({ items }: { items: MusicItem[] }) {
  const { width } = useWindowDimensions();
  const pageW = Math.round(width * 0.88);
  const pages = Array.from({ length: Math.ceil(items.length / PER_PAGE) }, (_, i) => items.slice(i * PER_PAGE, (i + 1) * PER_PAGE));
  const tracks = items.filter((i): i is Track => i.kind === 'track');
  return (
    <FlatList
      horizontal
      data={pages}
      keyExtractor={(p) => `${p[0].kind}-${p[0].id}`}
      showsHorizontalScrollIndicator={false}
      snapToInterval={pageW}
      decelerationRate="fast"
      contentContainerStyle={styles.content}
      renderItem={({ item: page }) => (
        <View style={{ width: pageW }}>
          {page.map((it) => {
            const sub = itemSubtitle(it);
            return (
              <Pressable
                key={`${it.kind}-${it.id}`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                onPress={() => (it.kind === 'track' ? playSong(tracks, tracks.indexOf(it), { source: 'home-quick' }) : openItem(it))}
                onLongPress={() => itemSheet(it)}
                delayLongPress={350}
                accessibilityRole="button"
                accessibilityLabel={[itemTitle(it), sub].filter(Boolean).join(', ')}>
                <Artwork art={it.artwork} size={48} round={it.kind === 'artist'} />
                <View style={styles.text}>
                  <Text style={styles.title} numberOfLines={1}>
                    {itemTitle(it)}
                  </Text>
                  {sub ? (
                    <Text style={styles.sub} numberOfLines={1}>
                      {sub}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { paddingLeft: theme.spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, height: 56, paddingRight: theme.spacing.lg },
  pressed: { opacity: 0.7 },
  text: { flex: 1 },
  title: { color: theme.colors.text, ...theme.typography.body },
  sub: { color: theme.colors.textSecondary, ...theme.typography.caption },
}));
