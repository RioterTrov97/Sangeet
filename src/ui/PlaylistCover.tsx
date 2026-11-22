import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { Artwork as ArtworkModel } from '../youtube/models';
import { Artwork } from './Artwork';

/** 2x2 grid cover from the artwork of a playlist's first 4 tracks (one image if only 1-3 exist). */
export function PlaylistCover({ art, size }: { art: ArtworkModel[][]; size: number }) {
  const { theme } = useUnistyles();
  if (!art.length) {
    return (
      <View style={[styles.empty, { width: size, height: size }]}>
        <SymbolView name="music.note.list" size={size * 0.4} tintColor={theme.colors.textSecondary} />
      </View>
    );
  }
  if (art.length < 4) return <Artwork art={art[0]} size={size} />;
  const h = size / 2;
  return (
    <View style={[styles.grid, { width: size, height: size }]} testID="playlist-cover-grid">
      {art.slice(0, 4).map((a, i) => (
        <Artwork key={i} art={a} size={h} style={styles.cell} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 4, overflow: 'hidden' },
  cell: { borderRadius: 0 },
  empty: { borderRadius: 4, backgroundColor: theme.colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
}));
