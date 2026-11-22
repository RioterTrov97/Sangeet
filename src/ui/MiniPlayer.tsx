import { router } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

import { Icon } from './Icon';

import { skipNext, togglePlay, useLoading, useNowPlaying, useProgress } from '../player';
import { Artwork } from './Artwork';
import { IconButton } from './Controls';
import { Glass } from './Glass';
import { MINI_H } from './floating';
import { tap } from './haptic';
import { usePaletteColor } from './palette/animated';
import { usePalette } from './palette/store';
import { OutputButton } from '../remote/DeviceButton';
import { useRemote } from '../remote/phone';
import { closeMiniPlayer } from './closeMini';
import { SwipeSkip } from './SwipeSkip';

/**
 * Collapsed player: a rounded floating card filled with the artwork colour (cross-fades on track change; the static
 * `elevated` grey with "Match colours" off) inside a glass edge. Progress is a thin accent line along the top edge,
 * clipped to the card's rounded corners. Swipe left, right or down to close, tap to open; AirPlay, play/pause and next sit on the right.
 */
export function MiniPlayer({ bottomInset = false }: { bottomInset?: boolean }) {
  const { track, isPlaying } = useNowPlaying();
  const loading = useLoading();
  const { position, duration } = useProgress();
  const palette = usePalette();
  const tvName = useRemote((r) => (r.status === 'off' ? undefined : r.tvName));
  const vivid = usePaletteColor('vivid');
  const fill = useAnimatedStyle(() => ({ backgroundColor: vivid.value }));
  if (!track) return null;
  const pct = duration > 0 ? Math.min(1, position / duration) : 0;
  const artist = track.artists.map((a) => a.name).join(', ');

  return (
    <View style={bottomInset ? styles.inset : undefined}>
      <SwipeSkip style={styles.container} sideways="close" onClose={() => void closeMiniPlayer()}>
        <Glass radius={20} tint="rgba(255,255,255,0.10)" style={styles.glass}>
          <Animated.View style={[StyleSheet.absoluteFill, fill, styles.fill]} pointerEvents="none" />
          <View style={styles.edge} pointerEvents="none" />
          <Pressable style={styles.row} onPress={() => router.push('/player')} accessibilityRole="button" accessibilityLabel={`Now playing ${track.title} by ${artist}. Open player`} accessibilityHint="Swipe left, right or down to close the player"
            accessibilityActions={[{ name: 'close', label: 'Close player' }]}
            onAccessibilityAction={(e) => e.nativeEvent.actionName === 'close' && void closeMiniPlayer()}>
            <Artwork art={track.artwork} size={48} style={styles.art} />
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>
                {track.title}
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                {tvName ? `Playing on ${tvName}` : artist}
              </Text>
            </View>
            <OutputButton size={26} tint="#FFFFFF" activeTint={palette.accent} />
            <Pressable
              onPress={() => {
                tap();
                void togglePlay();
              }}
              accessibilityRole="button"
              accessibilityLabel={loading ? 'Loading, pause' : isPlaying ? 'Pause' : 'Play'}
              style={[styles.play, { backgroundColor: palette.accent }]}>
              {loading ? <ActivityIndicator size="small" color={palette.onAccent} /> : <Icon name={isPlaying ? 'pause.fill' : 'play.fill'} size={18} tintColor={palette.onAccent} />}
            </Pressable>
            <IconButton name="forward.fill" size={20} color="#fff" label="Next" onPress={() => { tap(); void skipNext(); }} />
          </Pressable>
          <View style={styles.track} pointerEvents="none">
            <View style={[styles.progress, { width: `${pct * 100}%`, backgroundColor: palette.accent }]} />
          </View>
        </Glass>
      </SwipeSkip>
    </View>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  inset: { paddingBottom: Math.max(rt.insets.bottom, theme.spacing.sm), paddingHorizontal: 12, backgroundColor: theme.colors.background },
  container: { marginHorizontal: 0 },
  glass: { height: MINI_H },
  fill: { opacity: 0.94 },
  edge: { ...StyleSheet.absoluteFillObject, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: 8, paddingRight: theme.spacing.md, gap: theme.spacing.md },
  art: { borderRadius: 10 },
  text: { flex: 1, gap: 1 },
  title: { color: '#fff', ...theme.typography.body, fontFamily: theme.typography.heading.fontFamily },
  artist: { color: 'rgba(255,255,255,0.82)', ...theme.typography.caption },
  play: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  // Top-edge progress: the Glass clips (overflow hidden + radius), so the line follows the rounded corners.
  track: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  progress: { height: 3 },
}));
