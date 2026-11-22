import { Icon } from './Icon';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useDownloadRow } from '../downloads/manager';
import { useIsLiked } from '../library/store';
import { usePlayerStore } from '../player/store';
import { formatDuration } from '../player/format';
import type { Track } from '../youtube/models';
import { Artwork } from './Artwork';
import { DlMark } from './DlMark';
import { ProgressRing } from './DownloadButton';
import { Equalizer } from './Equalizer';
import { usePalette } from './palette/store';
import { trackSheet } from './actions';

/** Hands the palette accent to the playing row only, so a palette change re-renders one row instead of the whole list. */
function Accent({ children }: { children: (accent: string) => ReactNode }) {
  return <>{children(usePalette().accent)}</>;
}

export function TrackRow({ track, onPress, index, fallbackArt, showDuration = true }: { track: Track; onPress: () => void; index?: number; fallbackArt?: Track['artwork']; showDuration?: boolean }) {
  // Per-row selectors: a row re-renders only when it becomes (or stops being) the current track, or its play state changes while it is.
  const active = usePlayerStore((s) => s.queue[s.index]?.id === track.id);
  const isPlaying = usePlayerStore((s) => s.queue[s.index]?.id === track.id && (s.status === 'playing' || s.status === 'buffering'));
  const { theme } = useUnistyles();
  const liked = useIsLiked(track.id);
  const dl = useDownloadRow(track.id);
  const artist = track.artists.map((a) => a.name).join(', ');
  // Long-press and the ... button open the shared action sheet. The row must NOT be wrapped in a MenuView: its native
  // UIButton covers the whole row and swallows every tap before React sees it.
  const openSheet = () => trackSheet(track, fallbackArt);
  return (
    <View>
      <Pressable style={styles.row} onPress={onPress} onLongPress={openSheet} delayLongPress={350} accessibilityRole="button" accessibilityLabel={`${track.title} by ${artist}${active ? ', now playing' : ''}`} accessibilityHint="Long press for more options">
        {index !== undefined ? (
          <View style={styles.index}>{active ? <Accent>{(accent) => <Equalizer playing={isPlaying} color={accent} />}</Accent> : <Text style={styles.indexText}>{index + 1}</Text>}</View>
        ) : null}
        <View>
          <Artwork art={track.artwork.length ? track.artwork : (fallbackArt ?? [])} size={48} />
          {index === undefined && active ? (
            <View style={styles.eqOverlay}>
              <Accent>{(accent) => <Equalizer playing={isPlaying} color={accent} />}</Accent>
            </View>
          ) : null}
        </View>
        <View style={styles.text}>
          {active ? (
            <Accent>
              {(accent) => (
                <Text style={[styles.title, { color: accent }]} numberOfLines={1}>
                  {track.title}
                </Text>
              )}
            </Accent>
          ) : (
            <Text style={styles.title} numberOfLines={1}>
              {track.title}
            </Text>
          )}
          <View style={styles.subRow}>
            {track.explicit ? (
              <View style={styles.badge} accessibilityLabel="Explicit">
                <Text style={styles.badgeText}>E</Text>
              </View>
            ) : null}
            <DlMark id={track.id} />
            <Text style={[styles.artist, styles.artistText]} numberOfLines={1}>
              {artist}
            </Text>
          </View>
        </View>
        {dl && dl.state !== 'done' && dl.state !== 'failed' ? <ProgressRing fraction={dl.totalBytes ? dl.bytes / dl.totalBytes : 0} size={16} color={theme.colors.accent} /> : null}
        {dl?.state === 'failed' ? <Icon name="exclamationmark.arrow.circlepath" size={14} tintColor={theme.colors.error} accessibilityLabel="Download failed" /> : null}
        {liked ? <Icon name="heart.fill" size={14} tintColor={theme.colors.accent} /> : null}
        {showDuration && track.durationSec ? <Text style={styles.duration}>{formatDuration(track.durationSec)}</Text> : null}
        <Pressable style={styles.more} hitSlop={4} onPress={openSheet} accessibilityRole="button" accessibilityLabel={`More options for ${track.title}`}>
          <Icon name="ellipsis" size={18} tintColor={theme.colors.textSecondary} />
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingLeft: theme.spacing.lg, paddingRight: theme.spacing.xs, paddingVertical: theme.spacing.sm },
  index: { width: 22, alignItems: 'center' },
  indexText: { color: theme.colors.textSecondary, ...theme.typography.body },
  eqOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1 },
  title: { color: theme.colors.text, ...theme.typography.bodyLarge },
  active: { color: theme.colors.accent },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  artistText: { flexShrink: 1 },
  badge: { backgroundColor: theme.colors.textSecondary, borderRadius: 2, paddingHorizontal: 4, minWidth: 14, alignItems: 'center' },
  badgeText: { color: '#000', fontFamily: theme.typography.heading.fontFamily, fontSize: 10, lineHeight: 14 },
  artist: { flexShrink: 1, color: theme.colors.textSecondary, ...theme.typography.body },
  duration: { color: theme.colors.textSecondary, ...theme.typography.caption },
  more: { padding: theme.spacing.md },
}));
