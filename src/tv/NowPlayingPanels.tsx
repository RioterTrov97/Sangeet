import { useEffect, useRef, useState } from 'react';
import { Animated, FlatList, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '../player/format';
import { skipToIndex } from '../player';
import { usePlayerStore, useQueue } from '../player/store';
import { Equalizer } from '../ui/Equalizer';
import { Artwork } from '../ui/Artwork';
import { Image } from 'expo-image';
import { useVideoPicker, videoThumb } from '../video/picker';
import { usePalette } from '../ui/palette/store';
import type { Track } from '../youtube/models';
import { AUDIO_LABEL, AUDIO_QUALITIES, VIDEO_LABEL, videoOptions, type AudioQuality, type VideoQuality } from '../youtube/formats';
import { decoderCaps, osName, useQuality } from '../youtube/resolver/qualitySettings';
import { useStreamInfo } from '../youtube/resolver/streamInfo';
import { applyQuality } from '../video/quality';
import StreamProxy from '../../modules/stream-proxy';
import { Icon, type IconName } from './icons';
import { LAYOUT_LABELS, LAYOUTS, layoutForSwitch, type TvLayout } from './layout';
import { lastVideoLyrics, setTvLayout, tvLayout } from './playerPrefs';
import { watchVideo } from '../video/controller';
import { Focusable } from './ui';
import { tv } from './theme';
import { EmptyStateTV } from './EmptyStateTV';

export const LAYOUT_ICONS: Record<TvLayout, IconName> = { video: 'video', videoLyrics: 'videoLyrics', videoLyricsOverlay: 'videoLyricsOverlay', musicLyrics: 'library', music: 'now', lyrics: 'lyrics' };

/** Slides in from the right (and fades) in 200 ms. */
function useSlide(): Animated.Value {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [v]);
  return v;
}

/** The Layout picker: six options with icons; the saved layout is ticked and focused first. */
export function LayoutPicker({ value, onPick }: { value: TvLayout; onPick: (l: TvLayout) => void }) {
  const pal = usePalette();
  const a = useSlide();
  return (
    <Animated.View
      style={[st.picker, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }]}
      accessibilityViewIsModal>
      <Text style={st.pickerTitle}>Layout</Text>
      {LAYOUTS.map((l) => (
        <Focusable key={l} preferred={l === value} onPress={() => onPick(l)} label={LAYOUT_LABELS[l]} scale={1.03} style={st.opt} focusedStyle={st.optOn}>
          {(f) => (
            <>
              <Icon name={LAYOUT_ICONS[l]} size={32} color={f ? '#000' : '#fff'} />
              <Text style={[st.optText, f && { color: '#000' }]}>{LAYOUT_LABELS[l]}</Text>
              {l === value ? <Icon name="check" size={30} color={f ? '#000' : pal.accent} /> : null}
            </>
          )}
        </Focusable>
      ))}
    </Animated.View>
  );
}

/**
 * Quality picker: the video heights this TV decodes (while a video is showing) and the audio options. The choice is saved
 * (same setting as Settings) and applied to the current song; the subtitle says what is playing now.
 */
export function QualityPicker({ video, trackId, onClose }: { video: boolean; trackId?: string; onClose: () => void }) {
  const pal = usePalette();
  const a = useSlide();
  const q = useQuality();
  const playing = useStreamInfo((s) => (trackId ? s.byId[trackId] : undefined));
  const heights = videoOptions(osName(), decoderCaps(() => (StreamProxy as { decoderCaps?: () => never }).decoderCaps?.()));
  const row = (id: string, label: string, on: boolean, pick: () => void, sub?: string) => (
    <Focusable key={id} preferred={on} onPress={() => (pick(), onClose())} label={label} scale={1.03} style={st.opt} focusedStyle={st.optOn}>
      {(f) => (
        <>
          <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 8 }}>
            <Text style={[st.optText, f && { color: '#000' }]}>{label}</Text>
            {sub ? <Text style={[st.optSub, f && { color: '#333' }]}>{sub}</Text> : null}
          </View>
          {on ? <Icon name="check" size={30} color={f ? '#000' : pal.accent} /> : null}
        </>
      )}
    </Focusable>
  );
  return (
    <Animated.View style={[st.picker, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }]} accessibilityViewIsModal>
      <Text style={st.pickerTitle}>{video ? 'Video quality' : 'Audio quality'}</Text>
      {video
        ? heights.map((h: VideoQuality) => row(`v${h}`, VIDEO_LABEL[h], q.video === h, () => void applyQuality('video', h)))
        : AUDIO_QUALITIES.map((m: AudioQuality) => row(`a${m}`, AUDIO_LABEL[m], q.audio === m, () => void applyQuality('audio', m), q.audio === m && playing ? `Playing ${playing}` : undefined))}
    </Animated.View>
  );
}

/** "Choose video": the song's best video candidates; OK picks one. Mounted only while open, so it costs nothing otherwise. */
export function VideoPickerPanel({ track, onClose }: { track: Track; onClose: () => void }) {
  const pal = usePalette();
  const a = useSlide();
  const p = useVideoPicker(track);
  const act = (id: string, label: string, icon: IconName, run: () => void, close = true, on = false) => (
    <Focusable key={id} label={label} scale={1.02} onPress={() => (run(), close && onClose())} style={st.vAct} focusedStyle={st.qRowOn}>
      {(f) => (
        <>
          <Icon name={icon} size={28} color={f ? '#000' : '#fff'} />
          <Text style={[st.qTitle, { flex: 1 }, f && { color: '#000' }]}>{label}</Text>
          {on ? <Icon name="check" size={28} color={f ? '#000' : pal.accent} /> : null}
        </>
      )}
    </Focusable>
  );
  return (
    <Animated.View style={[st.panel, { opacity: a, transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }] }]} accessibilityViewIsModal>
      <Text style={st.panelTitle}>Choose video</Text>
      <Text style={st.panelSub}>{p.loading ? 'Looking for videos...' : p.rows.length ? 'Pick the video to play for this song' : 'No matching video found'}</Text>
      {p.rows.map((r, i) => (
        <Focusable key={r.id} preferred={r.current || (i === 0 && !p.rows.some((x) => x.current))} label={`${r.title}, ${r.badge}`} scale={1.02} onPress={() => (p.choose(r.id), setTvLayout(layoutForSwitch(tvLayout(), 'video', lastVideoLyrics())), void watchVideo(track), onClose())} style={st.vRow} focusedStyle={st.qRowOn}>
          {(f) => (
            <>
              <Image source={{ uri: videoThumb(r.id) }} style={st.vThumb} contentFit="cover" />
              <View style={{ flex: 1 }}>
                <Text style={[st.qTitle, f && { color: '#000' }]} numberOfLines={2}>
                  {r.title}
                </Text>
                <Text style={[st.qSub, f && { color: '#333' }]} numberOfLines={1}>
                  {[r.channel, r.duration, r.views].filter(Boolean).join(' · ')}
                </Text>
                <Text style={[st.vBadge, { color: f ? '#000' : r.badge === 'Music video' ? pal.accent : tv.textDim }]}>{r.badge}</Text>
              </View>
              {r.current ? <Icon name="check" size={28} color={f ? '#000' : pal.accent} /> : null}
            </>
          )}
        </Focusable>
      ))}
      {act('none', 'No video for this song', 'video', p.noVideo, true, p.none)}
      {act('check', p.checking ? 'Checking...' : 'Check again', 'history', p.check, false)}
      {p.overridden ? act('reset', 'Reset to automatic', 'back', p.reset) : null}
    </Animated.View>
  );
}

const ROW_H = 84;

/** Right-hand slide-over listing the queue. OK jumps to the chosen track; the playing one is focused first. */
export function UpNextPanel({ onClose }: { onClose: () => void }) {
  const { queue, index } = useQueue();
  const playing = usePlayerStore((s) => s.status === 'playing' || s.status === 'buffering');
  const pal = usePalette();
  const a = useSlide();
  const list = useRef<FlatList<Track>>(null);
  return (
    <Animated.View style={[st.panel, { opacity: a, transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }] }]} accessibilityViewIsModal>
      <Text style={st.panelTitle}>Up next</Text>
      <Text style={st.panelSub}>{queue.length ? `${Math.max(0, queue.length - index - 1)} after this song` : 'The queue is empty'}</Text>
      <FlatList
        ref={list}
        data={queue}
        keyExtractor={(t, i) => `${t.id}-${i}`}
        getItemLayout={(_d, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
        initialScrollIndex={Math.min(Math.max(0, index - 1), Math.max(0, queue.length - 1))}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        ListEmptyComponent={<EmptyStateTV compact icon="queue" title="The queue is empty" body="Add songs and they line up here." />}
        renderItem={({ item, index: i }) => (
          <Focusable
            preferred={i === index}
            label={item.title}
            scale={1.02}
            onPress={() => {
              if (i !== index) void skipToIndex(i);
              onClose();
            }}
            style={st.qRow}
            focusedStyle={st.qRowOn}>
            {(f) => (
              <>
                <View style={st.qIdx}>{i === index ? <Equalizer playing={playing} color={f ? '#000' : pal.accent} /> : <Text style={[st.qNum, f && { color: '#000' }]}>{i + 1}</Text>}</View>
                <Artwork art={item.artwork} size={56} style={{ borderRadius: 6 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[st.qTitle, f && { color: '#000' }, i === index && !f && { color: pal.accent }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={[st.qSub, f && { color: '#333' }]} numberOfLines={1}>
                    {item.artists.map((x) => x.name).join(', ')}
                  </Text>
                </View>
                <Text style={[st.qDur, f && { color: '#333' }]}>{item.durationSec ? formatDuration(item.durationSec) : ''}</Text>
              </>
            )}
          </Focusable>
        )}
      />
    </Animated.View>
  );
}

const st = StyleSheet.create({
  picker: { position: 'absolute', right: tv.gutter, bottom: 190, width: 520, borderRadius: 22, padding: 14, gap: 6, backgroundColor: 'rgba(24,24,28,0.98)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  pickerTitle: { color: tv.textDim, fontFamily: tv.font.bold, fontSize: 20, letterSpacing: 1.5, marginLeft: 16, marginTop: 6, marginBottom: 4, textTransform: 'uppercase' },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 18, minHeight: 64, paddingHorizontal: 18, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)' },
  optOn: { backgroundColor: '#fff' },
  optSub: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 18 },
  optText: { flex: 1, color: '#fff', fontFamily: tv.font.bold, fontSize: 26 },
  panel: { position: 'absolute', top: 0, right: 0, bottom: 0, width: 560, paddingTop: 36, paddingLeft: 20, paddingRight: 40, backgroundColor: 'rgba(14,14,16,0.99)', borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.12)' },
  panelTitle: { color: '#fff', fontFamily: tv.font.extraBold, fontSize: 34, marginLeft: 12 },
  panelSub: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 20, marginLeft: 12, marginBottom: 14 },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 16, height: ROW_H - 6, marginVertical: 3, paddingHorizontal: 12, borderRadius: 12, borderWidth: 3, borderColor: 'transparent' },
  qRowOn: { backgroundColor: '#fff', borderColor: '#fff' },
  vRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 92, marginVertical: 3, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 3, borderColor: 'transparent' },
  vThumb: { width: 128, height: 72, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)' },
  vBadge: { fontFamily: tv.font.bold, fontSize: 16, letterSpacing: 0.5 },
  vAct: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 64, marginVertical: 3, paddingHorizontal: 16, borderRadius: 12, borderWidth: 3, borderColor: 'transparent' },
  qIdx: { width: 32, alignItems: 'center' },
  qNum: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 20 },
  qTitle: { color: '#fff', fontFamily: tv.font.bold, fontSize: 22 },
  qSub: { color: tv.textDim, fontFamily: tv.font.regular, fontSize: 18 },
  qDur: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 18 },
});
