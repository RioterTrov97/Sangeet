import { FlashList } from '@shopify/flash-list';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { playSong } from './playSong';
import type { MusicItem } from '../youtube/models';
import { itemSheet } from './actions';
import { SectionTitle, Card } from './Layout';
import { openItem } from './nav';
import { itemSubtitle, itemTitle } from './itemText';

/** Title + horizontal FlashList of cards. Tracks play (and start radio); other kinds open their page. */
export function Shelf({ title, items, source = 'shelf', size = 140, action, onAction }: { title: string; items: MusicItem[]; source?: string; size?: number; /** Optional link on the title row (e.g. See all). */ action?: string; onAction?: () => void }) {
  if (!items.length) return null;
  return (
    <View>
      <SectionTitle title={title} action={action} onAction={onAction} />
      <FlashList
        horizontal
        data={items}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={Gap}
        keyExtractor={(it, i) => `${it.kind}-${it.id}-${i}`}
        renderItem={({ item }) => (
          <Card
            art={item.artwork}
            size={size}
            round={item.kind === 'artist'}
            title={itemTitle(item)}
            subtitle={itemSubtitle(item)}
            onLongPress={() => itemSheet(item)}
            onPress={() => (item.kind === 'track' ? playSong([item], 0, { source }) : openItem(item))}
          />
        )}
      />
    </View>
  );
}

const Gap = () => <View style={styles.gap} />;

const styles = StyleSheet.create((theme) => ({
  content: { paddingHorizontal: theme.spacing.lg },
  gap: { width: theme.spacing.md },
}));
