import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useLyrics, useLyricsSync, useLyricsTiming } from '../lyrics/useLyrics';
import { seekTo, togglePlay, useNowPlaying, useProgress } from '../player';
import { Backdrop } from './Backdrop';
import { IconButton, PlayButton } from './Controls';
import { LyricsView } from './LyricsView';
import { PlainLyrics } from './PlainLyrics';
import { SheetScreen } from './Screen';
import { Scrubber } from './Scrubber';
import { tap } from './haptic';

/** Full-screen lyrics: deep artwork colour, big centred lines, thin scrubber, one white play button. */
export function LyricsScreen() {
  const { track, isPlaying } = useNowPlaying();
  const { position, duration } = useProgress();
  const { status, lyrics } = useLyrics(track);
  const timing = useLyricsTiming(track);
  const sync = useLyricsSync(track);
  const offset = timing.offsetMs;
  const artist = track?.artists.map((a) => a.name).join(', ') ?? '';

  return (
    <SheetScreen>
      <Backdrop flat />
      <View style={styles.top}>
        <IconButton name="chevron.down" label="Close lyrics" onPress={() => router.back()} />
        <View style={styles.topText}>
          <Text style={styles.topTitle} numberOfLines={1}>{track?.title ?? ''}</Text>
          <Text style={styles.topSub} numberOfLines={1}>{artist}</Text>
        </View>
        <View style={{ width: 22 }} />
      </View>
      {status === 'loading' ? <Text style={styles.msg}>Looking for lyrics...</Text> : null}
      {status === 'none' || (status === 'ready' && !lyrics) ? <Text style={styles.msg}>No lyrics found for this song.</Text> : null}
      {lyrics?.synced?.length ? <LyricsView lines={lyrics.synced} offsetMs={offset} sync={sync} /> : null}
      {lyrics && !lyrics.synced?.length && lyrics.plain ? <PlainLyrics text={lyrics.plain} fontSize={22} trackId={track?.id} /> : null}
      <View style={styles.footer}>
        <View style={styles.seek}>
          <Scrubber position={position} duration={duration} onSeek={(s) => void seekTo(s)} />
        </View>
        <View style={styles.playRow}>
          {lyrics?.synced?.length && track ? (
            <View style={styles.offset} accessible={false}>
              <IconButton name="minus.circle" size={22} label="Lyrics later by half a second" onPress={() => sync?.onChange(timing.userOffsetMs - 500)} />
              <Text style={styles.offsetText} accessibilityLabel={`Lyrics offset ${(timing.userOffsetMs / 1000).toFixed(1)} seconds`}>
                {timing.userOffsetMs > 0 ? '+' : ''}
                {(timing.userOffsetMs / 1000).toFixed(1)}s
              </Text>
              <IconButton name="plus.circle" size={22} label="Lyrics earlier by half a second" onPress={() => sync?.onChange(timing.userOffsetMs + 500)} />
            </View>
          ) : <View style={styles.offset} />}
          <PlayButton size={64} playing={isPlaying} fill="#ffffff" onPress={() => { tap(); void togglePlay(); }} />
          <View style={styles.offset}>{lyrics ? <Text style={styles.attr}>{lyrics.source}</Text> : null}</View>
        </View>
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create((theme) => ({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.md },
  topText: { flex: 1, alignItems: 'center', paddingHorizontal: theme.spacing.md },
  topTitle: { color: theme.colors.text, ...theme.typography.heading },
  topSub: { color: 'rgba(255,255,255,0.7)', ...theme.typography.caption },
  msg: { color: 'rgba(255,255,255,0.8)', ...theme.typography.bodyLarge, textAlign: 'center', marginTop: 80 },
  footer: { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.md, gap: theme.spacing.sm },
  seek: { height: 52 },
  playRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  offset: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm },
  offsetText: { color: 'rgba(255,255,255,0.8)', ...theme.typography.caption, minWidth: 36, textAlign: 'center' },
  attr: { color: 'rgba(255,255,255,0.55)', ...theme.typography.caption },
}));
