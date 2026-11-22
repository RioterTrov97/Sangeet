import { LinearGradient } from 'expo-linear-gradient';
import { VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native-unistyles';
import { useNavigation } from 'expo-router';
import { create } from 'zustand';

import { useLyrics, useLyricsSync, useLyricsTiming } from '../lyrics/useLyrics';
import { seekTo, togglePlay, useNowPlaying, useProgress } from '../player';
import { useVideoStore } from '../video/controller';
import { nextFit, resolveFit, type VideoFitPref } from '../video/fit';
import { getJson, setJson } from '../util/storage';
import { IconButton, PlayButton } from './Controls';
import { LyricsView } from './LyricsView';
import { PlainLyrics } from './PlainLyrics';
import { Scrubber } from './Scrubber';
import { tap } from './haptic';

const HIDE_MS = 5000;

/** Picture mode (see video/fit): Auto by default, remembered once the user picks one. */
const FIT_KEY = 'video.fullscreenFit.v2';
const useVideoFit = create<VideoFitPref>(() => getJson<VideoFitPref>(FIT_KEY) ?? 'auto');
const setVideoFit = (f: VideoFitPref) => {
  useVideoFit.setState(f, true);
  setJson(FIT_KEY, f);
};
const FIT_ICON = { auto: 'aspectratio', fill: 'rectangle.fill', fit: 'rectangle.center.inset.filled' } as const;
const FIT_LABEL = { auto: 'Auto', fill: 'Fill', fit: 'Fit' } as const;

/** The playing video's frame size (from the player's video track), undefined until known. */
function useVideoSize(player: ReturnType<typeof useVideoStore.getState>['player']) {
  // Size updates are tagged with the player they came from, so a new player starts from its own current size.
  const [update, setUpdate] = useState<{ player: typeof player; size: { width: number; height: number } | undefined }>();
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener('videoTrackChange', ({ videoTrack }) => setUpdate({ player, size: videoTrack?.size }));
    return () => sub.remove();
  }, [player]);
  const size = update?.player === player ? update.size : player?.videoTrack?.size;
  return size && size.width > 0 && size.height > 0 ? size : undefined;
}

/** True while the full-screen route is open: the inline stage lets go of the player so only one VideoView shows it. */
export const useVideoFullscreen = create<boolean>(() => false);

/**
 * Our own full-screen video (route `/video`: a landscape full-screen modal with the status bar and home indicator hidden; every
 * other screen is portrait). The picture mode button cycles Auto / Fill / Fit (see video/fit). The player is the same object the inline stage used, so playback
 * is never paused or restarted when entering or leaving. Tap shows / hides the controls; the lyrics button draws the
 * synced (or plain) lyrics on the right over a gradient scrim.
 */
export function VideoFullscreen({ onClose }: { onClose: () => void }) {
  const { width: W, height: H } = useWindowDimensions(); // landscape: W is the long side
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { player } = useVideoStore();
  const { track, isPlaying } = useNowPlaying();
  const { position, duration } = useProgress();
  const { lyrics } = useLyrics(track);
  const timing = useLyricsTiming(track);
  const sync = useLyricsSync(track);
  const offset = timing.offsetMs;
  const [controls, setControls] = useState(true);
  const [showLyrics, setShowLyrics] = useState(false);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hasLyrics = !!(lyrics?.synced?.length || lyrics?.plain);
  const fitPref = useVideoFit();
  const videoSize = useVideoSize(player);
  const fit = resolveFit(fitPref, videoSize, Math.max(W, H), Math.min(W, H));

  // The controls hide a few seconds after the last touch, but stay while paused.
  const playingRef = useRef(isPlaying);
  useEffect(() => void (playingRef.current = isPlaying), [isPlaying]);
  const arm = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => playingRef.current && setControls(false), HIDE_MS);
  }, []);
  useEffect(() => {
    arm();
    return () => clearTimeout(timer.current);
  }, [arm]);
  useEffect(() => {
    useVideoFullscreen.setState(true, true);
    return () => useVideoFullscreen.setState(false, true);
  }, []);

  // Landscape safe area: the notch / island side and the home indicator side.
  const sideL = 24 + insets.left;
  const sideR = 24 + insets.right;
  const toggle = () => {
    if (controls) setControls(false);
    else {
      setControls(true);
      arm();
    }
  };
  // Leaving: draw plain black, hand the video back to the inline stage, and turn this screen to portrait while it is still
  // up; dismiss only once the window is portrait. Dismissing straight from landscape makes iOS show the portrait player
  // sideways during the fade and rotate it afterwards.
  const close = () => {
    if (closing) return;
    setClosing(true);
    clearTimeout(timer.current);
    useVideoFullscreen.setState(false, true);
    navigation.setOptions({ orientation: 'portrait' });
  };
  const closed = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!closing || closed.current) return;
    const finish = () => {
      if (closed.current) return;
      closed.current = true;
      onCloseRef.current();
    };
    if (H > W) {
      requestAnimationFrame(finish); // let the black frame draw in portrait first
      return;
    }
    const fallback = setTimeout(finish, 1000); // never stuck if the rotation does not happen
    return () => clearTimeout(fallback);
  }, [closing, W, H]);
  const act = (fn: () => void) => () => {
    tap();
    fn();
    arm();
  };
  if (closing) return <View style={styles.root} />;
  return (
    <View style={styles.root}>
      {player ? <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={fit === 'fill' ? 'cover' : 'contain'} nativeControls={false} allowsPictureInPicture={false} fullscreenOptions={{ enable: false }} /> : null}
      <Pressable style={StyleSheet.absoluteFill} onPress={toggle} accessibilityLabel="Show or hide video controls" />
      {showLyrics && hasLyrics ? (
        <View style={styles.lyricsWrap} pointerEvents="box-none">
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          <View style={[styles.lyrics, { right: sideR - 12 }]}>
            {lyrics?.synced?.length ? (
              <LyricsView lines={lyrics.synced} offsetMs={offset} compact fade="#000" sync={sync} />
            ) : (
              <PlainLyrics text={lyrics?.plain ?? ''} fontSize={18} fade="#000" trackId={track?.id} />
            )}
          </View>
        </View>
      ) : null}
      {controls ? (
        <>
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)']} style={styles.topScrim} />
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} style={styles.bottomScrim} />
          <View style={[styles.top, { left: sideL, right: sideR }]} pointerEvents="box-none">
            <IconButton name="xmark" size={22} color="#fff" label="Exit full screen" onPress={close} />
            <View style={styles.titles} pointerEvents="none">
              <Text style={styles.title} numberOfLines={1}>
                {track?.title ?? ''}
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                {track?.artists.map((a) => a.name).join(', ') ?? ''}
              </Text>
            </View>
            <Pressable
              style={styles.fitPill}
              hitSlop={10}
              onPress={act(() => setVideoFit(nextFit(fitPref)))}
              accessibilityRole="button"
              accessibilityLabel={`Picture: ${FIT_LABEL[fitPref]}${fitPref === 'auto' ? ` (${FIT_LABEL[fit]})` : ''}. Tap to change`}>
              <SymbolView name={FIT_ICON[fitPref]} size={16} tintColor="#fff" />
              <Text style={styles.fitText}>{FIT_LABEL[fitPref]}</Text>
            </Pressable>
            {hasLyrics ? <IconButton name="quote.bubble" size={22} color="#fff" active={showLyrics} label={showLyrics ? 'Hide lyrics' : 'Show lyrics'} onPress={act(() => setShowLyrics((v) => !v))} /> : <View style={{ width: 22 }} />}
          </View>
          <View style={[styles.bottom, { left: sideL, right: sideR }]} pointerEvents="box-none">
            <PlayButton size={46} playing={isPlaying} fill="#ffffff" onPress={act(() => void togglePlay())} />
            <View style={styles.seek}>
              <Scrubber position={position} duration={duration} onSeek={(s) => (void seekTo(s), arm())} />
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: '#000' },
  lyricsWrap: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '45%' },
  lyrics: { position: 'absolute', top: 0, bottom: 0, right: 12, width: '82%' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 90 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 120 },
  top: { position: 'absolute', top: 20, left: 24, right: 24, flexDirection: 'row', alignItems: 'center', gap: 16 },
  titles: { flex: 1 },
  title: { color: '#fff', ...theme.typography.heading },
  artist: { color: 'rgba(255,255,255,0.75)', ...theme.typography.caption },
  bottom: { position: 'absolute', bottom: 18, left: 24, right: 24, flexDirection: 'row', alignItems: 'center', gap: 16 },
  seek: { flex: 1, height: 52 },
  fitPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)' },
  fitText: { color: '#fff', ...theme.typography.caption, fontFamily: theme.typography.heading.fontFamily },
}));
