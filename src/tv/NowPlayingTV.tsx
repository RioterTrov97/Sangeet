import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView } from 'expo-video';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Animated, AppState, StyleSheet, Text, View } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { toggleLike, useIsLiked } from '../library/store';
import { lyricsFor } from './lyricsLines';
import { seekTo, setRepeat, setShuffle, skipNext, skipPrevious, togglePlay, useNowPlaying, useProgress } from '../player';
import { formatDuration } from '../player/format';
import { usePlayerStore } from '../player/store';
import { useLyrics, useLyricsSync, useLyricsTiming } from '../lyrics/useLyrics';
import { stepSync, syncVisible } from '../lyrics/syncAdjust';
import { pingSyncArrows } from '../lyrics/syncReveal';
import { usePalette } from '../ui/palette/store';
import { pickArtwork } from '../youtube/mappers/common';
import { enterVideo, exitVideo, useVideoStore, watchVideo } from '../video/controller';
import { canChooseVideo, useVideoId } from '../video/counterpart';
import { VIDEO_SETTLE_MS } from '../video/handover';
import { onTvKey, setCapturedKeys } from '../../modules/tv-keys';
import { markActivity } from './activity';
import { pushBack } from './back';
import { Icon, type IconName } from './icons';
import { layoutForSwitch, lyricsKind, resolveLayout, sideVideoSize, usesVideo, type TvLayout } from './layout';
import { LyricsView, type PlainScroller } from './LyricsView';
import { LAYOUT_ICONS, LayoutPicker, QualityPicker, UpNextPanel, VideoPickerPanel } from './NowPlayingPanels';
import { AUDIO_LABEL, VIDEO_LABEL } from '../youtube/formats';
import { useQuality } from '../youtube/resolver/qualitySettings';
import { lastVideoLyrics, setTvLayout, useTvPlayer } from './playerPrefs';
import { tv } from './theme';
import { STARTING_MS, useHostUi } from '../remote/hostUi';
import { Focusable } from './ui';
import { EmptyStateTV } from './EmptyStateTV';
import { setBeforeLeaveNow, tvNav } from './nav';

const SEEK = 10;
/** Key-repeat count at which a held Up / Down resets the lyrics sync (repeats start about half a second after the press). */
const SYNC_RESET_REPEAT = 12;
const IDLE_MS = 5000;
/** Extra room the centred music artwork leaves at the bottom so its titles are not under the controls while they are shown (the content itself is never resized). */
const CLEAR = 90;
const SAFE_Y = 28;
/** Artwork sizes: the big cover (shown 400-420 design px, about 560 physical) and the small thumbnail beside the title. */
const ART_BIG = 640;
const ART_THUMB = 160;
/** Controls band show/hide and the content's matching scale. */
const CONTROLS_MS = 420;

/** True while a panel (Layout picker / Up next) is open: the controls underneath must not take focus. */
const Blocked = createContext(false);

function Circle({ icon, label, onPress, preferred, active, size = 64 }: { icon: IconName; label: string; onPress: () => void; preferred?: boolean; active?: boolean; size?: number }) {
  const pal = usePalette();
  const blocked = useContext(Blocked);
  return (
    <Focusable onPress={onPress} preferred={preferred} disabled={blocked} label={label} scale={1.12} style={[st.circle, { width: size, height: size, borderRadius: size / 2 }, active && { backgroundColor: 'rgba(255,255,255,0.22)' }]} focusedStyle={{ backgroundColor: '#fff' }}>
      {(f) => <Icon name={icon} size={size * 0.5} color={f ? '#000' : active ? pal.accent : '#fff'} />}
    </Focusable>
  );
}

function Pill({ icon, label, onPress, preferred }: { icon: IconName; label: string; onPress: () => void; preferred?: boolean }) {
  const blocked = useContext(Blocked);
  return (
    <Focusable onPress={onPress} preferred={preferred} disabled={blocked} label={label} scale={1.08} style={st.pill} focusedStyle={{ backgroundColor: '#fff' }}>
      {(f) => (
        <>
          <Icon name={icon} size={28} color={f ? '#000' : '#fff'} />
          <Text style={[st.pillText, f && { color: '#000' }]}>{label}</Text>
        </>
      )}
    </Focusable>
  );
}

/** Focusable seek bar: while focused, D-pad left/right seek by 10 s (the Activity forwards those keys). */
function SeekBar({ active }: { active: boolean }) {
  const { position, duration } = useProgress();
  const pal = usePalette();
  const blocked = useContext(Blocked);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused || !active) return;
    setCapturedKeys(['left', 'right']);
    const sub = onTvKey(({ key }) => {
      if (key !== 'left' && key !== 'right') return;
      markActivity();
      const s = usePlayerStore.getState();
      const dur = s.duration || s.queue[s.index]?.durationSec || 0;
      const to = Math.max(0, Math.min(dur > 1 ? dur - 1 : Infinity, s.position + (key === 'right' ? SEEK : -SEEK)));
      usePlayerStore.setState({ position: to });
      void seekTo(to);
    });
    return () => {
      sub.remove();
      setCapturedKeys([]);
    };
  }, [focused, active]);
  const frac = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <Focusable onPress={() => void togglePlay()} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} disabled={blocked} dim={false} label="Progress. Left and right to seek 10 seconds" scale={1.0} style={st.seekWrap}>
      {(f) => (
        <View style={st.seekRow}>
          <Text style={st.time}>{formatDuration(position)}</Text>
          <View style={[st.track, f && { height: 12 }]}>
            <View style={[st.fill, { width: `${frac * 100}%`, backgroundColor: f ? '#fff' : pal.accent }]} />
            {f ? <View style={[st.knob, { left: `${frac * 100}%` }]} /> : null}
          </View>
          <Text style={st.time}>{formatDuration(duration)}</Text>
        </View>
      )}
    </Focusable>
  );
}

/** Blurred artwork on the palette gradient. `ambient` slowly breathes a second colour over it (Music only). */
function Backdrop({ art, ambient }: { art?: string; ambient?: boolean }) {
  const pal = usePalette();
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!ambient) return;
    const loop = Animated.loop(Animated.sequence([Animated.timing(t, { toValue: 1, duration: 9000, useNativeDriver: true }), Animated.timing(t, { toValue: 0, duration: 9000, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [ambient, t]);
  return (
    <>
      {/* The static layers are cached as one texture, so the breathing layer above them (and any focus animation) re-composites one quad instead of re-drawing three full-screen layers every frame. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill} renderToHardwareTextureAndroid>
        <LinearGradient pointerEvents="none" colors={[pal.bg, pal.bgDeep]} style={StyleSheet.absoluteFill} />
        {art ? <Image source={{ uri: art }} style={[StyleSheet.absoluteFill, { opacity: 0.38 }]} blurRadius={70} contentFit="cover" /> : null}
        <LinearGradient pointerEvents="none" colors={[`${pal.bg}55`, `${pal.bgDeep}ee`]} style={StyleSheet.absoluteFill} />
      </View>
      {ambient ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.55] }) }]}>
          <LinearGradient colors={[`${pal.accent}66`, 'transparent', `${pal.bg}cc`]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
    </>
  );
}

function Titles({ title, artist, album, align = 'left', big, lines = 2 }: { title: string; artist: string; album?: string; align?: 'left' | 'center'; big?: boolean; lines?: number }) {
  return (
    <View style={{ alignItems: align === 'center' ? 'center' : 'flex-start' }}>
      <Text style={[st.title, big && { fontSize: 44, lineHeight: 52 }, { textAlign: align }]} numberOfLines={lines}>
        {title}
      </Text>
      <Text style={[st.artist, { textAlign: align }]} numberOfLines={1}>
        {artist}
        {album ? `  •  ${album}` : ''}
      </Text>
    </View>
  );
}

export function NowPlayingTV() {
  const { track, isPlaying, shuffle, repeat } = useNowPlaying();
  const liked = useIsLiked(track?.id);
  const pal = usePalette();
  const video = useVideoStore();
  const pref = useTvPlayer((s) => s.layout);
  const { status, lyrics } = useLyrics(track);
  const timing = useLyricsTiming(track);
  const sync = useLyricsSync(track);
  const offset = timing.offsetMs;
  const videoId = useVideoId(track);
  const kind = lyricsKind(status, lyrics);
  const layout: TvLayout = resolveLayout(pref, videoId === undefined ? undefined : !!videoId, kind);
  const wantVideo = usesVideo(layout);
  const inVideo = video.mode === 'video';

  // The next song's artwork is fetched while this one plays, so a Next shows its cover, thumbnail and blurred backdrop at once.
  const nextTrack = usePlayerStore((p) => p.queue[p.index + 1]);
  useEffect(() => {
    if (!nextTrack) return;
    const urls = [480, ART_BIG, ART_THUMB].map((n) => pickArtwork(nextTrack.artwork, n)).filter((u): u is string => !!u);
    if (urls.length) void Image.prefetch(urls).catch(() => false);
  }, [nextTrack]);

  // Plain (unsynced) lyrics register their scroller here: with the controls hidden, Up / Down scroll them instead of waking the controls.
  const plainScroll = useRef<PlainScroller | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | undefined>();
  const [picker, setPicker] = useState(false);
  const [upNext, setUpNext] = useState(false);
  const [quality, setQualityOpen] = useState(false);
  const [chooseVid, setChooseVid] = useState(false);
  const [restore, setRestore] = useState<'layout' | 'queue' | 'quality' | 'video' | undefined>();
  const panel = picker || upNext || quality || chooseVid;
  const qSet = useQuality();
  const [idleRaw, setIdle] = useState(false);
  const idle = idleRaw && !panel;
  // One UI-thread value fades/slides the controls (0 = shown, 1 = hidden). The content always uses the full screen and the
  // controls draw on top of it with a bottom scrim, so showing or hiding them never moves or resizes the video / lyrics.
  const hidden = useSharedValue(0);
  useEffect(() => {
    hidden.value = withTiming(idle ? 1 : 0, { duration: CONTROLS_MS, easing: Easing.inOut(Easing.cubic) });
  }, [idle, hidden]);
  const thinStyle = useAnimatedStyle(() => ({ opacity: hidden.value }));
  const bandStyle = useAnimatedStyle(() => ({ opacity: 1 - hidden.value, transform: [{ translateY: hidden.value * 36 }] }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: 1 - hidden.value }));

  // The saved layout decides whether this screen plays the song's video; leaving the screen returns to audio.
  const entering = useRef<string | undefined>(undefined);
  const [fg, setFg] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => setFg(st === 'active'));
    return () => sub.remove();
  }, []);
  // Video starts only once Now Playing has been on screen a moment with no Back pending: a Back queued during the mount
  // (this screen takes ~2 s to appear on the Streamer) must not start a video that is torn down straight away.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSettled(true), VIDEO_SETTLE_MS);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!track || !fg) return;
    if (wantVideo && !inVideo && settled && entering.current !== track.id) {
      entering.current = track.id;
      void enterVideo(track).finally(() => void (entering.current = undefined));
    } else if (!wantVideo && (inVideo || video.loading)) void exitVideo();
  }, [wantVideo, inVideo, track, fg, video.loading, settled]);
  // Leaving this screen hands the video back to audio at the moment of navigation (off-screen: no crossfade); the unmount cleanup is the safety net.
  useEffect(() => {
    setBeforeLeaveNow(() => void exitVideo({ offscreen: true }));
    return () => {
      setBeforeLeaveNow(undefined);
      void exitVideo({ offscreen: true });
    };
  }, []);

  // Controls: shown on any input, idle after 5 s (video layouts hide them, music layouts keep a thin progress line).
  const [tick, setTick] = useState(0);
  const wake = () => {
    markActivity();
    setIdle(false);
    setTick((t) => t + 1);
  };
  useEffect(() => {
    if (panel) return;
    const id = setTimeout(() => setIdle(true), IDLE_MS);
    return () => clearTimeout(id);
  }, [tick, panel]);
  const syncRef = useRef<typeof sync>(undefined);
  const hasSynced = !!lyrics?.synced?.length;
  useEffect(() => void (syncRef.current = hasSynced ? sync : undefined), [sync, hasSynced]);
  // While idle, swallow the next D-pad key: OK toggles play/pause, anything else just brings the controls back.
  useEffect(() => {
    if (!idle || panel) return;
    setCapturedKeys(['left', 'right', 'up', 'down', 'center']);
    const sub = onTvKey(({ key, repeat: rep }) => {
      if (!['left', 'right', 'up', 'down', 'center'].includes(key)) return;
      if ((key === 'up' || key === 'down') && plainScroll.current?.(key)) return void markActivity();
      // Synced lyrics whose timing is a guess (or adjusted): Up / Down nudge them 0.5 s earlier / later without bringing the controls
      // back; holding the key for about a second resets the adjustment.
      const sy = syncRef.current;
      if ((key === 'up' || key === 'down') && syncVisible(sy)) {
        markActivity();
        pingSyncArrows();
        if (rep === 0) sy!.onChange(stepSync(sy!.ms, key === 'up' ? 1 : -1));
        else if (rep === SYNC_RESET_REPEAT) sy!.onChange(0);
        return;
      }
      if (key === 'center' && rep === 0) void togglePlay();
      wake();
    });
    return () => {
      sub.remove();
      setCapturedKeys([]);
    };
  }, [idle, panel]);
  // Back closes an open panel first, then hides the controls; only a Back with the controls hidden leaves the screen.
  // (Up, or any D-pad key, brings them back: see the idle key capture above.)
  useEffect(
    () =>
      pushBack(() => {
        if (picker) {
          setPicker(false);
          setRestore('layout');
          return true;
        }
        if (upNext) {
          setUpNext(false);
          setRestore('queue');
          return true;
        }
        if (quality) {
          setQualityOpen(false);
          setRestore('quality');
          return true;
        }
        if (chooseVid) {
          setChooseVid(false);
          setRestore('video');
          return true;
        }
        if (!idleRaw) {
          markActivity();
          setIdle(true);
          return true;
        }
        return false;
      }),
    [picker, upNext, quality, chooseVid, idleRaw],
  );
  useEffect(() => {
    if (!restore) return;
    const id = setTimeout(() => setRestore(undefined), 400);
    return () => clearTimeout(id);
  }, [restore]);

  if (!track) return <EmptyOrStarting />;
  const art = pickArtwork(track.artwork, ART_BIG);
  // The blurred backdrop needs no more than a thumbnail (the blur is computed on the CPU when the image loads).
  const bd = pickArtwork(track.artwork, 480);
  const thumbUri = pickArtwork(track.artwork, ART_THUMB);
  const artist = track.artists.map((a) => a.name).join(', ');
  const synced = lyricsFor(lyrics?.synced);
  const lyricsNode = (variant: 'side' | 'full' | 'overlay') => <LyricsView synced={synced} plain={lyrics?.plain} trackId={track.id} status={status} offsetMs={offset} variant={variant} sync={synced.length ? sync : undefined} idle={idle} onActivity={wake} scrollRef={plainScroll} />;
  const videoView = (rounded: boolean, size?: object) =>
    video.player && inVideo ? (
      <View style={rounded ? [st.videoInset, size] : StyleSheet.absoluteFill}>
        <VideoView player={video.player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} surfaceType={rounded ? 'textureView' : undefined} />
        {/* A track change inside video mode: the new song's artwork (the small, prefetched size: a 1200 px image was still downloading and blurring while the panel sat black) instead of the old frame, on the palette colour, until the first frame. */}
        {video.loading ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: pal.bgDeep }]} pointerEvents="none">
            {bd ? <Image source={{ uri: bd }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} /> : null}
          </View>
        ) : null}
      </View>
    ) : (
      <View style={[rounded ? [st.videoInset, size] : StyleSheet.absoluteFill, st.videoWait]}>
        {bd && rounded ? <Image source={{ uri: bd }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} /> : null}
        <Text style={st.loading}>{video.loading || videoId === undefined || wantVideo ? 'Loading video...' : ''}</Text>
      </View>
    );

  const onIdleVideoLayout = layout === 'video' || layout === 'videoLyricsOverlay';
  let body: React.ReactNode;
  if (layout === 'video') {
    body = (
      <View style={st.black}>
        {videoView(false)}
      </View>
    );
  } else if (layout === 'videoLyricsOverlay') {
    // Immersive: the video fills the screen, the lyrics sit on its right over a dark gradient, the title top-left fades with the controls.
    body = (
      <View style={st.black}>
        {videoView(false)}
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.86)', 'rgba(0,0,0,0.9)']} locations={[0, 0.3, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={st.ovScrim} />
        <View style={st.ovLyrics}>{lyricsNode('overlay')}</View>
        <Reanimated.View pointerEvents="none" style={[st.ovTitle, fadeStyle]}>
          <Text style={st.ovTitleText} numberOfLines={1}>
            {track.title}
          </Text>
          <Text style={st.ovArtist} numberOfLines={1}>
            {artist}
          </Text>
        </Reanimated.View>
      </View>
    );
  } else if (layout === 'videoLyrics') {
    body = (
      <>
        <Backdrop art={bd} />
        <View style={st.area}>
          <View style={st.vlRow}>
            <View style={st.vlLeft} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
              <View style={st.vlVideoArea}>
                <View style={[st.vlVideoBox, box && sideVideoSize(box.w, box.h, VL_META_H)]}>{videoView(true, st.vlVideo)}</View>
              </View>
              <View style={st.vlMeta}>
                <Image key={thumbUri} source={thumbUri ? { uri: thumbUri } : undefined} style={st.vlThumb} contentFit="cover" />
                <View style={{ flex: 1 }}>
                  <Titles title={track.title} artist={artist} album={track.album?.name} lines={1} />
                </View>
              </View>
            </View>
            <View style={st.vlPanel}>{lyricsNode('side')}</View>
          </View>
        </View>
      </>
    );
  } else if (layout === 'musicLyrics') {
    body = (
      <>
        <Backdrop art={bd} />
        <View style={st.area}>
          <View style={st.mlRow}>
            <View style={st.mlArt}>
              <Image key={art} source={art ? { uri: art } : undefined} style={st.artBig} contentFit="cover" />
              <View style={{ marginTop: 22, width: 420 }}>
                <Titles title={track.title} artist={artist} album={track.album?.name} />
              </View>
            </View>
            <View style={st.mlLyrics}>{lyricsNode('full')}</View>
          </View>
        </View>
      </>
    );
  } else if (layout === 'lyrics') {
    body = (
      <>
        <Backdrop art={bd} />
        <View style={st.lyHead}>
          <Image key={thumbUri} source={thumbUri ? { uri: thumbUri } : undefined} style={st.thumb} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <Text style={st.thumbTitle} numberOfLines={1}>
              {track.title}
            </Text>
            <Text style={st.thumbArtist} numberOfLines={1}>
              {artist}
            </Text>
          </View>
        </View>
        <View style={[st.area, st.lyArea]}>
          <View style={st.lyBody}>{lyricsNode('full')}</View>
        </View>
      </>
    );
  } else {
    body = (
      <>
        <Backdrop art={bd} ambient />
        <View style={st.area}>
          <View style={st.musicCol}>
            <Image key={art} source={art ? { uri: art } : undefined} style={st.artHuge} contentFit="cover" />
            <View style={{ marginTop: 26, width: 900 }}>
              <Titles title={track.title} artist={artist} album={track.album?.name} align="center" big />
            </View>
          </View>
        </View>
      </>
    );
  }

  const controls = (
    <Reanimated.View style={[st.band, bandStyle]} onTouchStart={wake}>
      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.78)']} style={st.bandScrim} />
      {layout === 'video' ? (
        <View style={st.videoTitle} pointerEvents="none">
          <Titles title={track.title} artist={artist} />
        </View>
      ) : null}
      <SeekBar active={!idle} />
      <View style={st.controls}>
        <View style={st.group}>
          <Circle icon="prev" label="Previous" onPress={() => void skipPrevious()} />
          <Circle icon={isPlaying ? 'pause' : 'play'} label={isPlaying ? 'Pause' : 'Play'} onPress={() => void togglePlay()} preferred size={80} />
          <Circle icon="next" label="Next" onPress={() => void skipNext()} />
        </View>
        <View style={st.group}>
          <Circle icon={liked ? 'heart' : 'heartOutline'} label={liked ? 'Unlike' : 'Like'} onPress={() => toggleLike(track)} active={liked} />
          <Circle icon="shuffle" label="Shuffle" onPress={() => void setShuffle(!shuffle)} active={shuffle} />
          <Circle icon={repeat === 'one' ? 'repeatOne' : 'repeat'} label={`Repeat ${repeat}`} onPress={() => void setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')} active={repeat !== 'off'} />
        </View>
        <View style={st.group}>
          <Pill icon={LAYOUT_ICONS[pref]} label="Layout" onPress={() => setPicker(true)} preferred={restore === 'layout'} />
          <Pill icon="settings" label={inVideo ? VIDEO_LABEL[qSet.video].replace('Maximum', 'Max') : AUDIO_LABEL[qSet.audio]} onPress={() => setQualityOpen(true)} preferred={restore === 'quality'} />
          {videoId && !inVideo ? <Pill icon="video" label="Watch video" onPress={() => (setTvLayout(layoutForSwitch(pref, 'video', lastVideoLyrics())), void watchVideo(track))} /> : null}
          {canChooseVideo(track) ? <Pill icon="video" label="Choose video" onPress={() => setChooseVid(true)} preferred={restore === 'video'} /> : null}
          <Pill icon="queue" label="Up next" onPress={() => setUpNext(true)} preferred={restore === 'queue'} />
        </View>
      </View>
    </Reanimated.View>
  );
  const thin = !onIdleVideoLayout ? (
    <Reanimated.View pointerEvents="none" style={[st.thin, thinStyle]}>
      <ThinProgress color={pal.accent} />
    </Reanimated.View>
  ) : null;

  return (
    <Blocked.Provider value={panel}>
      <View style={[st.root, { backgroundColor: pal.bg }]}>
        {body}
        {thin}
        {controls}
        {picker ? (
          <LayoutPicker
            value={pref}
            onPick={(l) => {
              setTvLayout(l);
              setPicker(false);
              setRestore('layout');
            }}
          />
        ) : null}
        {quality ? <QualityPicker video={inVideo} trackId={track.id} onClose={() => (setQualityOpen(false), setRestore('quality'))} /> : null}
        {chooseVid ? <VideoPickerPanel track={track} onClose={() => (setChooseVid(false), setRestore('video'))} /> : null}
        {upNext ? <UpNextPanel onClose={() => (setUpNext(false), setRestore('queue'))} /> : null}
      </View>
    </Blocked.Provider>
  );
}

function ThinProgress({ color }: { color: string }) {
  const { position, duration } = useProgress();
  return (
    <View style={st.thinTrack}>
      <View style={{ height: '100%', width: `${duration > 0 ? Math.min(100, (position / duration) * 100) : 0}%`, backgroundColor: color }} />
    </View>
  );
}

/**
 * No track yet. Right after a phone started playback (often by launching the app) this is a pulsing skeleton of the
 * player with "Starting playback from <phone>"; otherwise, or after STARTING_MS, the plain empty message.
 */
function EmptyOrStarting() {
  const starting = useHostUi((u) => u.starting);
  const [expired, setExpired] = useState<number | undefined>();
  useEffect(() => {
    if (!starting) return;
    const id = setTimeout(() => setExpired(starting.at), Math.max(0, STARTING_MS - (Date.now() - starting.at)));
    return () => clearTimeout(id);
  }, [starting]);
  const active = !!starting && expired !== starting.at;
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.8, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  if (!active) {
    return (
      <View style={st.empty}>
        <EmptyStateTV icon="now" title="Nothing is playing" body="Pick something from Home or Search." action={{ label: 'Go to Home', onPress: () => tvNav().root({ name: 'home' }), preferred: true }} />
      </View>
    );
  }
  return (
    <View style={st.empty}>
      <Reanimated.View style={[st.startCol, pulseStyle]}>
        <View style={st.startArt} />
        <View style={[st.startBar, { width: 420, height: 34 }]} />
        <View style={[st.startBar, { width: 260, height: 24 }]} />
        <View style={[st.startBar, { width: 900, height: 8, marginTop: 36 }]} />
      </Reanimated.View>
      <Text style={st.startText}>Starting playback from {starting?.from}…</Text>
    </View>
  );
}

const VL_META_H = 128; // thumbnail row below the video in the Video + Lyrics box
const st = StyleSheet.create({
  root: { flex: 1 },
  black: { ...StyleSheet.absoluteFill, backgroundColor: '#000' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  startCol: { alignItems: 'center', gap: 18 },
  startArt: { width: 440, height: 440, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.12)', marginBottom: 12 },
  startBar: { borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.12)' },
  startText: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 24, marginTop: 40 },
  title: { color: '#fff', fontFamily: tv.font.extraBold, fontSize: 34, lineHeight: 42 },
  artist: { color: 'rgba(255,255,255,0.78)', fontFamily: tv.font.medium, fontSize: 24, marginTop: 4 },
  // Content always fills the screen; the controls draw over it.
  area: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  lyArea: { top: SAFE_Y + 100 },
  // Video + Lyrics: a 70% column (song details over the 16:9 video) and a 30% glass lyrics panel the same height.
  vlRow: { position: 'absolute', top: SAFE_Y + 8, bottom: SAFE_Y + 8, left: tv.gutter, right: tv.gutter, flexDirection: 'row', gap: 28 },
  // One black box as tall as the lyrics panel: the video on top (16:9, shrinks so the meta row always fits), details centred below.
  vlLeft: { width: '70%', backgroundColor: '#000', borderRadius: 24, overflow: 'hidden' },
  // Fixed-height title row at the bottom; the video is centred in the space above it.
  vlVideoArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  vlMeta: { height: VL_META_H, flexDirection: 'row', alignItems: 'center', gap: 18, paddingLeft: 36, paddingRight: 24 },
  vlThumb: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#222' },
  vlVideoBox: { width: '100%', aspectRatio: 16 / 9, alignSelf: 'center' },
  vlVideo: { width: '100%', height: '100%', aspectRatio: undefined, borderRadius: 0 },
  vlPanel: { flex: 1, borderRadius: 24, paddingHorizontal: 26, paddingVertical: 24, backgroundColor: 'rgba(10,10,14,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  videoInset: { width: '100%', aspectRatio: 16 / 9, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' },
  videoWait: { alignItems: 'center', justifyContent: 'center' },
  loading: { color: '#fff', fontFamily: tv.font.bold, fontSize: 28 },
  // Music + Lyrics
  mlRow: { position: 'absolute', top: SAFE_Y, bottom: CLEAR, left: tv.gutter, right: tv.gutter, flexDirection: 'row', gap: 48 },
  mlArt: { width: '40%', alignItems: 'flex-start', justifyContent: 'center' },
  artBig: { width: 420, height: 420, borderRadius: 18, backgroundColor: '#222' },
  mlLyrics: { flex: 1 },
  // Lyrics only
  lyHead: { position: 'absolute', top: SAFE_Y + 4, left: tv.gutter, right: 480, flexDirection: 'row', alignItems: 'center', gap: 18 },
  thumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: '#222' },
  thumbTitle: { color: '#fff', fontFamily: tv.font.bold, fontSize: 28 },
  thumbArtist: { color: 'rgba(255,255,255,0.75)', fontFamily: tv.font.medium, fontSize: 22 },
  // Immersive Video + Lyrics
  ovScrim: { position: 'absolute', top: 0, bottom: 0, right: 0, width: '60%' },
  ovLyrics: { position: 'absolute', top: SAFE_Y, bottom: 0, right: 40, width: '35%' },
  ovTitle: { position: 'absolute', top: SAFE_Y, left: tv.gutter, right: '45%' },
  ovTitleText: { color: '#fff', fontFamily: tv.font.extraBold, fontSize: 30, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 8 },
  ovArtist: { color: 'rgba(255,255,255,0.85)', fontFamily: tv.font.medium, fontSize: 22, marginTop: 2, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 8 },
  lyBody: { position: 'absolute', top: 0, bottom: 0, left: 120, right: 120 },
  // Music only
  musicCol: { position: 'absolute', top: SAFE_Y, bottom: CLEAR, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  artHuge: { width: 400, height: 400, borderRadius: 20, backgroundColor: '#222' },
  // Controls band
  band: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: tv.gutter, paddingBottom: SAFE_Y },
  bandScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 330 },
  videoTitle: { marginBottom: 6 },
  seekWrap: { paddingVertical: 12 },
  seekRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  time: { color: '#fff', fontFamily: tv.font.medium, fontSize: 22, width: 76, textAlign: 'center' },
  track: { flex: 1, height: 8, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.28)', justifyContent: 'center' },
  fill: { height: '100%', borderRadius: 7 },
  knob: { position: 'absolute', width: 26, height: 26, borderRadius: 13, marginLeft: -13, backgroundColor: '#fff' },
  // Three groups centred in the safe area: when the pills (Watch video + Choose video as well) do not fit beside the circles, the pill group wraps to its own row instead of running off the screen.
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: 28, rowGap: 12 },
  group: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  circle: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 64, paddingHorizontal: 20, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.12)' },
  pillText: { color: '#fff', fontFamily: tv.font.bold, fontSize: 24 },
  thin: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  thinTrack: { height: 5, backgroundColor: 'rgba(255,255,255,0.18)' },
});
