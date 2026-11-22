import { Image } from 'expo-image';
import { VideoView } from 'expo-video';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useNowPlaying } from '../player';
import { useVideoStore } from '../video/controller';
import { pickArtwork } from '../youtube/mappers/common';
import { IconButton } from './Controls';
import { useVideoFullscreen } from './VideoFullscreen';

/**
 * 16:9 video in place of the artwork. The expand button opens our own full-screen view (route `/video`) over the player:
 * it shows the same `player`, so audio and picture carry on without a pause. The inline view is unmounted meanwhile so only
 * one VideoView is attached to the player.
 */
export function VideoStage({ width }: { width: number }) {
  const { player, loading } = useVideoStore();
  const { track } = useNowPlaying();
  const poster = track ? pickArtwork(track.artwork, 480) : undefined;
  const full = useVideoFullscreen();
  const height = Math.round((width * 9) / 16);
  return (
    <View style={[styles.wrap, { width, height }]}>
      {player && !full ? <VideoView player={player} style={{ width, height }} contentFit="contain" nativeControls={false} allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} /> : null}
      {loading && poster ?<Image source={{ uri: poster }} style={{ width, height, position: 'absolute' }} contentFit="cover" blurRadius={20} pointerEvents="none" /> : null}
      {loading ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
      <View style={styles.fs}>
        <IconButton name="arrow.up.left.and.arrow.down.right" size={18} color="#fff" label="Full screen video" onPress={() => router.push('/video')} />
      </View>
    </View>
  );
}

/** Song | Video segmented toggle. Video is disabled when the track has no video. */
export function SongVideoToggle({ mode, videoAvailable, onChange }: { mode: 'song' | 'video'; videoAvailable: boolean | undefined; onChange: (m: 'song' | 'video') => void }) {
  return (
    <View style={styles.toggle} accessibilityRole="tablist">
      <Pressable style={[styles.seg, mode === 'song' && styles.segOn]} onPress={() => onChange('song')} accessibilityRole="tab" accessibilityState={{ selected: mode === 'song' }} accessibilityLabel="Song">
        <Text style={[styles.segText, mode === 'song' && styles.segTextOn]}>Song</Text>
      </Pressable>
      <Pressable
        style={[styles.seg, mode === 'video' && styles.segOn]}
        onPress={() => videoAvailable && onChange('video')}
        disabled={!videoAvailable}
        accessibilityRole="tab"
        accessibilityState={{ selected: mode === 'video', disabled: !videoAvailable }}
        accessibilityLabel={videoAvailable ? 'Video' : videoAvailable === undefined ? 'Video, checking availability' : 'Video, not available for this song'}>
        <Text style={[styles.segText, mode === 'video' && styles.segTextOn, !videoAvailable && styles.segOff]}>Video</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { backgroundColor: '#000', borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  fs: { position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 16, padding: 7 },
  toggle: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: theme.radii.full, padding: 3 },
  seg: { paddingHorizontal: theme.spacing.lg, paddingVertical: 6, borderRadius: theme.radii.full },
  segOn: { backgroundColor: 'rgba(255,255,255,0.9)' },
  segText: { color: theme.colors.text, ...theme.typography.body, fontFamily: theme.typography.heading.fontFamily },
  segTextOn: { color: '#000' },
  segOff: { opacity: 0.35 },
}));
