import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { playSong } from './playSong';
import type { MusicItem } from '../youtube/models';
import { Artwork } from './Artwork';
import { itemSheet } from './actions';
import { MoreButton } from './MoreButton';
import { itemSubtitle, itemTitle } from './itemText';
import { openItem } from './nav';
import { TrackRow } from './TrackRow';

/** Row for any search/browse item: tracks play (single + radio), the rest open their page. */
export function MusicItemRow({ item, onOpen }: { item: MusicItem; onOpen?: () => void }) {
  if (item.kind === 'track') return <TrackRow track={item} onPress={() => (onOpen?.(), playSong([item], 0, { source: 'search' }))} />;
  return (
    <Pressable style={styles.row} onPress={() => (onOpen?.(), openItem(item))} onLongPress={() => itemSheet(item)} delayLongPress={350} accessibilityRole="button" accessibilityLabel={`${item.kind} ${itemTitle(item)}`}>
      <Artwork art={item.artwork} size={56} round={item.kind === 'artist'} />
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {itemTitle(item)}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {itemSubtitle(item)}
        </Text>
      </View>
      <MoreButton label={`More options for ${itemTitle(item)}`} onPress={() => itemSheet(item)} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingLeft: theme.spacing.lg, paddingRight: theme.spacing.xs, paddingVertical: theme.spacing.sm },
  text: { flex: 1 },
  title: { color: theme.colors.text, ...theme.typography.bodyLarge },
  sub: { color: theme.colors.textSecondary, ...theme.typography.body },
}));
