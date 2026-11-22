import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Share, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TextTicker from 'react-native-text-ticker';
import { StyleSheet } from 'react-native-unistyles';
import type { SFSymbol } from 'expo-symbols';
import { SymbolView } from 'expo-symbols';

import { savedArtworkUrl, useIsAutoCached } from '../downloads/autoCache';
import { downloadTracks, removeDownload, retryDownload, useDownloadRow } from '../downloads/manager';
import { useIsOffline } from '../downloads/net';
import { useLyrics, useLyricsSync, useLyricsTiming } from '../lyrics/useLyrics';
import { toggleLike, useIsLiked } from '../library/store';
import { playOfflineSongs, seekTo, setRepeat, setShuffle, skipNext, skipPrevious, togglePlay, useLoading, useNowPlaying, useProgress } from '../player';
import { exitVideo, isCarPlayConnected, useVideoStore, watchVideo } from '../video/controller';
import { isLocalId } from '../local/id';
import { canChooseVideo, useVideoId } from '../video/counterpart';
import { Artwork } from './Artwork';
import { Backdrop } from './Backdrop';
import { IconButton } from './Controls';
import { Glass } from './Glass';
import { LyricsView } from './LyricsView';
import { PlainLyrics } from './PlainLyrics';
import { OutputButton } from '../remote/DeviceButton';
import { setTvQuality, setTvSide, useRemote, watchTvVideo } from '../remote/phone';
import { applyQuality } from '../video/quality';
import { AUDIO_LABEL, AUDIO_QUALITIES, VIDEO_LABEL, videoOptions } from '../youtube/formats';
import { useQuality } from '../youtube/resolver/qualitySettings';
import { sideOfLayout } from '../player/layout';
import { OnTvStrip } from './OnTvStrip';
import { Scrubber } from './Scrubber';
import { SwipeSkip } from './SwipeSkip';
import { VideoStage } from './VideoStage';
import { tap } from './haptic';
import { ActionSheetHost } from './ActionSheet';
import { addToPlaylistPage } from './actions';
import { openAlbum, openArtist } from './nav';
import { setPlayerOpen } from './playerOpen';
import { openActionSheet, type SheetAction } from './sheet';
import { openVideoPicker } from './VideoPickerSheet';
import { foregroundFor } from './palette/derive';
import { usePalette } from './palette/store';
import { SheetScreen } from './Screen';

export function PlayerScreen() {
  // The player is a native modal, so the sheet needs its own provider (the root one renders behind it).
  return (
    <BottomSheetModalProvider>
      <PlayerContent />
    </BottomSheetModalProvider>
  );
}

type View3 = 'song' | 'video' | 'lyrics';

/** Song | Video pill (lyrics live in the bottom row). With no video it stays as a lone, selected, non-interactive Song segment. */
function ModePill({ value, videoAvailable, onChange }: { value: View3; videoAvailable: boolean | undefined; onChange: (v: View3) => void }) {
  const palette = usePalette();
  const songOnly = videoAvailable === false;
  const items: { key: View3; label: string; off?: boolean }[] = songOnly ? [{ key: 'song', label: 'Song' }] : [
    { key: 'song', label: 'Song' },
    { key: 'video', label: 'Video', off: !videoAvailable },
  ];
  return (
    <Glass radius={20} style={pillStyles.wrap} tint="rgba(0,0,0,0.28)" intensity={30}>
      <View style={pillStyles.row} accessibilityRole="tablist">
        {items.map((it) => {
          const on = songOnly || value === it.key;
          return (
            <Pressable key={it.key} disabled={it.off || songOnly} onPress={() => onChange(it.key)} style={[pillStyles.seg, on && { backgroundColor: palette.accent }]} accessibilityRole="tab" accessibilityState={{ selected: on, disabled: !!it.off || songOnly }} accessibilityLabel={it.label}>
              <Text style={[pillStyles.text, on && { color: palette.onAccent }, it.off && { opacity: 0.4 }]}>{it.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Glass>
  );
}

const pillStyles = StyleSheet.create((theme) => ({
  wrap: { alignSelf: 'center' },
  row: { flexDirection: 'row', padding: 3 },
  seg: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 17 },
  text: { color: '#fff', ...theme.typography.body, fontFamily: theme.typography.heading.fontFamily },
}));

function GlassCircleFace({ name, color = '#fff', size = 40 }: { name: SFSymbol; color?: string; size?: number }) {
  return (
    <Glass radius={size / 2} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} interactive>
      <SymbolView name={name} size={size * 0.45} tintColor={color} />
    </Glass>
  );
}

function GlassCircle({ name, label, onPress, color = '#fff', size = 40 }: { name: SFSymbol; label: string; onPress: () => void; color?: string; size?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}>
      <GlassCircleFace name={name} color={color} size={size} />
    </Pressable>
  );
}

function PlayerContent() {
  const { track, isPlaying, shuffle, repeat } = useNowPlaying();
  const loading = useLoading();
  const { position, duration } = useProgress();
  const palette = usePalette();
  const fg = foregroundFor(palette.bg);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const liked = useIsLiked(track?.id);
  const dl = useDownloadRow(track?.id);
  const offline = useIsOffline();
  const autoSaved = useIsAutoCached(track?.id);
  // Offline on a song that needs the network: a quiet line under the artist (the song still waits; nothing is blocked).
  const offlineHint = offline && dl?.state !== 'done' && !autoSaved;
  // The on-device artwork (checked once per song / save state, not on every progress tick): offline the remote art is not loadable.
  const dlDone = dl?.state === 'done';
  const savedArt = useMemo(() => (track && (autoSaved || dlDone) ? savedArtworkUrl(track.id) : undefined), [track, autoSaved, dlDone]);
  const videoId = useVideoId(track);
  // The Video tab opens at the tap: while the video loads the stage shows the artwork and a spinner (loading is only set by an enter or in video mode).
  const mode = useVideoStore((v) => (v.mode === 'video' || v.loading ? 'video' : 'song'));
  const quality = useQuality();
  const tvName = useRemote((r) => (r.status === 'off' ? undefined : r.tvName));
  const tvSide = useRemote((r) => (r.tvLayout ? sideOfLayout(r.tvLayout) : r.tvMode));
  const tvVideoId = useRemote((r) => r.tvInfo?.videoId);
  const videoNote = useVideoStore((v) => v.error);
  const [lyricsOn, setLyricsOn] = useState(false);
  const [stage, setStage] = useState({ w: width, h: 320 });
  const { lyrics, status } = useLyrics(track);
  const timing = useLyricsTiming(track);
  const sync = useLyricsSync(track);
  const offset = timing.offsetMs;

  useEffect(() => {
    setPlayerOpen(true);
    return () => setPlayerOpen(false);
  }, []);
  useEffect(() => {
    useVideoStore.setState({ error: undefined });
  }, [track?.id]);

  if (!track) {
    return (
      <SheetScreen style={[styles.container, styles.center]}>
        <Backdrop blobs={false} />
        <Text style={[styles.sub, { color: fg.dim }]}>Nothing playing</Text>
      </SheetScreen>
    );
  }
  const artist = track.artists.map((a) => a.name).join(', ');
  const artSize = Math.max(120, Math.min(width - 48, stage.h - 8, 380));
  const remote = !!tvName;
  // Controlling a TV: the artwork stays on the phone (no local video); the Audio / Video switch drives the TV's layout.
  const view: View3 = lyricsOn ? 'lyrics' : remote ? 'song' : mode;
  const pillValue: View3 = lyricsOn ? 'lyrics' : remote ? (tvSide === 'video' ? 'video' : 'song') : mode;
  const pick = (v: View3) => {
    tap();
    if (v === 'lyrics') return setLyricsOn(true);
    setLyricsOn(false);
    if (remote) return setTvSide(v === 'video' ? 'video' : 'audio');
    if (v === 'video' && mode !== 'video') void watchVideo(track);
    if (v === 'song' && mode === 'video') void exitVideo();
  };
  const videoAvailable = isCarPlayConnected() ? false : remote ? (tvVideoId === undefined ? true : !!tvVideoId) : videoId === undefined ? undefined : !!videoId;
  const link = `https://music.youtube.com/watch?v=${track.id}`;
  const local = isLocalId(track.id); // a song from this iPhone: no download, share link or video
  const qualityPick = (kind: 'video' | 'audio', v: string) => () => void (remote ? setTvQuality(kind, v) : applyQuality(kind, v));
  const openMenu = () => {
    const download: SheetAction[] =
      dl?.state === 'done'
        ? [{ id: 'undl', label: 'Remove download', icon: 'trash', onPress: () => removeDownload(track.id) }]
        : dl?.state === 'failed'
          ? [{ id: 'retrydl', label: 'Retry download', icon: 'arrow.clockwise', onPress: () => retryDownload(track.id) }]
          : [{ id: 'dl', label: dl ? 'Downloading…' : 'Download', icon: 'arrow.down.circle', onPress: () => void (!dl && downloadTracks([track])) }];
    openActionSheet({
      header: { title: track.title, subtitle: artist, art: track.artwork },
      actions: [
        ...(view === 'lyrics' ? [{ id: 'fulllyrics', label: 'Full-screen lyrics', icon: 'arrow.up.left.and.arrow.down.right' as const, onPress: () => router.push('/lyrics') }] : []),
        ...(local ? [] : download),
        ...(local ? [] : [{ id: 'share', label: 'Share', icon: 'square.and.arrow.up' as const, onPress: () => void Share.share({ message: link }) }]),
        ...(local ? [] : [{ id: 'vq', label: 'Video quality', icon: 'play.rectangle' as const, sub: { title: 'Video quality', actions: videoOptions('ios', undefined).map((v) => ({ id: `vq:${v}`, label: VIDEO_LABEL[v], icon: 'play.rectangle' as const, checked: quality.video === v, onPress: qualityPick('video', v) })) } }]),
        ...(local ? [] : [{ id: 'aq', label: 'Audio quality', icon: 'waveform' as const, sub: { title: 'Audio quality', actions: AUDIO_QUALITIES.map((a) => ({ id: `aq:${a}`, label: AUDIO_LABEL[a], icon: 'waveform' as const, checked: quality.audio === a, onPress: qualityPick('audio', a) })) } }]),
        ...(videoId && !remote && mode !== 'video' && !isCarPlayConnected() ? [{ id: 'wv', label: 'Watch video', icon: 'play.rectangle.fill' as const, onPress: () => void watchVideo(track) }] : []),
        ...(remote && tvVideoId !== null && tvSide !== 'video' ? [{ id: 'wvtv', label: 'Watch video on TV', icon: 'play.rectangle.fill' as const, onPress: () => watchTvVideo() }] : []),
        ...(canChooseVideo(track) ? [{ id: 'cv', label: 'Choose video', icon: 'play.rectangle.on.rectangle' as const, onPress: () => openVideoPicker(track) }] : []),
        { id: 'addpl', label: 'Add to playlist', icon: 'music.note.list', sub: addToPlaylistPage(async () => [track], track.title) },
        ...(track.album?.id ? [{ id: 'album', label: 'Go to album', icon: 'square.stack' as const, onPress: () => (router.back(), openAlbum(track.album!.id)) }] : []),
        ...(track.artists[0]?.id ? [{ id: 'artist', label: 'Go to artist', icon: 'person.circle' as const, onPress: () => (router.back(), openArtist(track.artists[0].id!)) }] : []),
      ],
    });
  };

  return (
    <SheetScreen style={[styles.container, { paddingBottom: insets.bottom + 20 }]}>
      <Backdrop paused={view === 'lyrics'} flat={view === 'lyrics'} />
      <View style={styles.top}>
        <IconButton name="chevron.down" color={fg.text} label="Close player" onPress={() => router.back()} />
        <ModePill value={pillValue} videoAvailable={videoAvailable} onChange={pick} />
        <IconButton name="list.bullet" size={24} color={fg.text} label="Queue, up next" onPress={() => router.push('/queue' as never)} />
      </View>

      <View style={styles.stage} onLayout={(e) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {view === 'lyrics' ? (
          lyrics?.synced?.length ? (
            <LyricsView lines={lyrics.synced} offsetMs={offset} compact sync={sync} />
          ) : (
            lyrics?.plain ? (
              <PlainLyrics text={lyrics.plain} trackId={track.id} />
            ) : (
              <Text style={styles.msg}>{status === 'loading' ? 'Looking for lyrics...' : 'No lyrics found for this song.'}</Text>
            )
          )
        ) : (
          <SwipeSkip style={styles.artWrap}>
            {view === 'video' ? <VideoStage width={Math.min(width - 48, 520)} /> : <Artwork art={track.artwork} size={artSize} style={styles.art} saved={savedArt} preferSaved={offline} />}
          </SwipeSkip>
        )}
      </View>
      {videoNote && view === 'song' && !remote ? <Text style={styles.note}>{videoNote}</Text> : null}
      {remote ? <OnTvStrip color={fg.text} dim={fg.dim} accent={palette.accent} /> : null}

      <View style={styles.metaRow}>
        <View style={styles.meta}>
          <TextTicker style={[styles.title, { color: fg.text }]} duration={9000} loop bounce={false} repeatSpacer={50} marqueeDelay={1500} accessibilityRole="header">
            {track.title}
          </TextTicker>
          <Pressable onPress={() => (track.artists[0]?.id ? (router.back(), openArtist(track.artists[0].id)) : undefined)} accessibilityRole="button" accessibilityLabel={`Artist ${artist}`}>
            <Text style={[styles.sub, { color: fg.dim }]} numberOfLines={1}>
              {artist}
            </Text>
          </Pressable>
          {offlineHint && !tvName ? (
            <Pressable onPress={() => { tap(); void playOfflineSongs(); }} style={styles.offline} accessibilityRole="button" accessibilityLabel="You're offline. This song plays when you're back online. Play offline songs">
              <SymbolView name="wifi.slash" size={13} tintColor={fg.dim} />
              <Text style={[styles.offlineText, { color: fg.dim }]} numberOfLines={1}>
                Offline · <Text style={{ color: palette.accent }}>Play offline songs</Text>
              </Text>
            </Pressable>
          ) : null}
          {tvName ? (
            <Text style={[styles.sub, { color: palette.accent }]} numberOfLines={1} accessibilityLabel={`Playing on ${tvName}`}>
              Playing on {tvName}
            </Text>
          ) : null}
        </View>
        <GlassCircle name={liked ? 'heart.fill' : 'heart'} color={liked ? palette.accent : fg.text} label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'} onPress={() => { tap(); toggleLike(track); }} />
        <Pressable onPress={openMenu} accessibilityRole="button" accessibilityLabel="More options">
          <GlassCircleFace name="ellipsis" color={fg.text} />
        </Pressable>
      </View>

      <View style={styles.seek}>
        <Scrubber position={position} duration={duration} onSeek={(s) => void seekTo(s)} tint={palette.accent} dim={fg.dim} />
      </View>

      <View style={styles.controls}>
        <IconButton name="backward.fill" size={38} color={fg.text} label="Previous" onPress={() => { tap(); void skipPrevious(); }} />
        <Pressable onPress={() => { tap(); void togglePlay(); }} accessibilityRole="button" accessibilityLabel={loading ? 'Loading, pause' : isPlaying ? 'Pause' : 'Play'} style={[styles.play, { backgroundColor: palette.accent }]}>
          {loading ? <ActivityIndicator size="large" color={palette.onAccent} /> : <SymbolView name={isPlaying ? 'pause.fill' : 'play.fill'} size={34} tintColor={palette.onAccent} />}
        </Pressable>
        <IconButton name="forward.fill" size={38} color={fg.text} label="Next" onPress={() => { tap(); void skipNext(); }} />
      </View>

      <View style={styles.secondary}>
        <IconButton name="quote.bubble" size={22} active={view === 'lyrics'} color={view === 'lyrics' ? palette.accent : fg.text} label="Lyrics" onPress={() => pick(view === 'lyrics' ? 'song' : 'lyrics')} />
        <IconButton name="shuffle" size={22} color={shuffle ? palette.accent : fg.text} active={shuffle} label={shuffle ? 'Shuffle on' : 'Shuffle off'} onPress={() => void setShuffle(!shuffle)} />
        <IconButton name={repeat === 'one' ? 'repeat.1' : 'repeat'} size={22} color={repeat !== 'off' ? palette.accent : fg.text} active={repeat !== 'off'} label={`Repeat ${repeat}`} onPress={() => void setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')} />
        <OutputButton size={26} tint={fg.text} activeTint={palette.accent} />
      </View>
      <ActionSheetHost scope="player" />
    </SheetScreen>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {},
  center: { alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: theme.spacing.xl, paddingTop: 12, paddingBottom: theme.spacing.sm },
  stage: { flex: 1, justifyContent: 'center', marginVertical: 12 },
  artWrap: { alignItems: 'center', justifyContent: 'center' },
  art: { borderRadius: 10 },
  msg: { color: 'rgba(255,255,255,0.8)', ...theme.typography.bodyLarge, textAlign: 'center', paddingHorizontal: theme.spacing.xl },
  note: { color: 'rgba(255,255,255,0.75)', ...theme.typography.caption, textAlign: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.lg },
  meta: { flex: 1, gap: 2 },
  title: { color: '#fff', ...theme.typography.display, fontSize: 24, lineHeight: 30 },
  sub: { ...theme.typography.bodyLarge },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, alignSelf: 'flex-start' },
  offlineText: { ...theme.typography.caption },
  seek: { paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.sm },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.md },
  play: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.spacing.xxl, marginTop: theme.spacing.xl + 4 },
}));
