import Constants from 'expo-constants';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { THIRD_PARTY_NOTE, THIRD_PARTY_SOURCES, toggleSource, useLyricsSources } from '../lyrics/settings';
import { setMatchColors, usePaletteStore } from '../ui/palette/store';
import { setAllowLyric, useVideoSettings } from '../video/settings';
import { setBackgroundPlay, useBackgroundPlay } from './playerPrefs';
import { AUDIO_LABEL, AUDIO_QUALITIES, VIDEO_LABEL, VIDEO_QUALITIES } from '../youtube/formats';
import { LANGUAGE_OPTIONS, REGION_OPTIONS, labelFor, setContentLocale, useContentLocale } from '../youtube/contentLocale';
import { setQuality, useQuality } from '../youtube/resolver/qualitySettings';
import { useStreamInfo } from '../youtube/resolver/streamInfo';
import { usePlayerStore } from '../player/store';
import { Focusable } from './ui';
import { useCanInstallRefresh } from './UpdateTV';
import { checkForUpdate, installNow, openInstallSettings, setAutoUpdate, updaterAvailable, useUpdate } from '../update/store';
import { statusLine } from '../update/text';
import { tv } from './theme';

const LABELS: Record<string, string> = { lrclib: 'LRCLIB (synced lyrics)', lrcred: 'lrc.red (word and line synced)', netease: 'NetEase (synced)', ytmusic: 'YouTube Music lyrics' };

function Toggle({ label, note, on, onPress, preferred }: { label: string; note?: string; on: boolean; onPress: () => void; preferred?: boolean }) {
  return (
    <Focusable onPress={onPress} preferred={preferred} label={`${label}, ${on ? 'on' : 'off'}`} style={st.item} focusedStyle={st.itemOn} scale={1.02}>
      <View style={{ flex: 1 }}>
        <Text style={st.itemTitle}>{label}</Text>
        {note ? <Text style={st.itemNote}>{note}</Text> : null}
      </View>
      <View style={[st.sw, on && st.swOn]}>
        <View style={[st.knob, on && st.knobOn]} />
      </View>
    </Focusable>
  );
}

function cycle<T>(list: readonly T[], cur: T): T {
  return list[(list.indexOf(cur) + 1) % list.length];
}

/** One row that steps through the options on OK (a TV has no pickers). */
function Choice({ label, note, value, onPress }: { label: string; note?: string; value: string; onPress: () => void }) {
  return (
    <Focusable onPress={onPress} label={`${label}, ${value}. Press to change`} style={st.item} focusedStyle={st.itemOn} scale={1.02}>
      <View style={{ flex: 1 }}>
        <Text style={st.itemTitle}>{label}</Text>
        {note ? <Text style={st.itemNote}>{note}</Text> : null}
      </View>
      <Text style={st.itemValue}>{value}</Text>
    </Focusable>
  );
}

/** An action row (OK runs it). */
function Action({ label, note, onPress }: { label: string; note?: string; onPress: () => void }) {
  return (
    <Focusable onPress={onPress} label={label} style={st.item} focusedStyle={st.itemOn} scale={1.02}>
      <View style={{ flex: 1 }}>
        <Text style={st.itemTitle}>{label}</Text>
        {note ? <Text style={st.itemNote}>{note}</Text> : null}
      </View>
    </Focusable>
  );
}

/** Settings > Updates: only on builds that know where their releases live (see src/update/config.ts). */
function UpdatesSection() {
  const u = useUpdate();
  useCanInstallRefresh();
  const busy = u.status === 'checking' || u.status === 'downloading' || u.status === 'installing';
  return (
    <>
      <Text style={st.section}>Updates</Text>
      <View style={st.item}>
        <View style={{ flex: 1 }}>
          <Text style={st.itemTitle}>Version {Constants.expoConfig?.version ?? ''}</Text>
          <Text style={st.itemNote}>{statusLine(u)}</Text>
        </View>
      </View>
      <Action label="Check for updates" onPress={() => !busy && void checkForUpdate({ force: true })} />
      {u.status === 'ready' && u.canInstall ? <Action label="Install update" note={`Version ${u.release?.version}. Sangeet restarts`} onPress={() => void installNow()} /> : null}
      {!u.canInstall && u.release ? <Action label="Allow installs" note="Android must allow Sangeet to install apps (Install unknown apps) before it can update itself" onPress={openInstallSettings} /> : null}
      <Toggle label="Install updates automatically" note="Downloads in the background and installs when nothing is playing" on={u.autoUpdate} onPress={() => setAutoUpdate(!u.autoUpdate)} />
    </>
  );
}

export function SettingsTV() {
  const q = useQuality();
  const nowId = usePlayerStore((s) => s.queue[s.index]?.id);
  const now = useStreamInfo((s) => (nowId ? s.byId[nowId] : undefined));
  const bg = useBackgroundPlay((s) => s.on);
  const lyricVideos = useVideoSettings((s) => s.allowLyric);
  const match = usePaletteStore((s) => s.matchColors);
  const sources = useLyricsSources((s) => s.sources);
  const { lang, region } = useContentLocale();
  return (
    <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
      <Text style={st.title}>Settings</Text>
      <Toggle preferred label="Match colours to music" note="Tint backgrounds with the artwork colours" on={match} onPress={() => setMatchColors(!match)} />
      <Toggle label="Keep playing in background" note="Off: music pauses when you leave Sangeet" on={bg} onPress={() => setBackgroundPlay(!bg)} />
      <Text style={st.section}>Playback quality</Text>
      <Choice label="Audio quality" note={now ? `Now playing: ${now}. Applies from the next song` : 'Maximum is the best AAC offered. Applies from the next song'} value={AUDIO_LABEL[q.audio]} onPress={() => setQuality({ audio: cycle(AUDIO_QUALITIES, q.audio) })} />
      <Choice label="Video quality" note="Maximum uses the best stream this TV can decode. Applies from the next video" value={VIDEO_LABEL[q.video]} onPress={() => setQuality({ video: cycle(VIDEO_QUALITIES, q.video) })} />
      <Toggle label="Use lyric videos" note="When a song has no music video, play a lyric video of the same song by the same artist" on={lyricVideos} onPress={() => setAllowLyric(!lyricVideos)} />
      <Text style={st.section}>Content</Text>
      <Choice label="Content language" note="Language of titles and shelves. Changing it reloads Home" value={labelFor(LANGUAGE_OPTIONS, lang)} onPress={() => setContentLocale({ lang: cycle(LANGUAGE_OPTIONS, LANGUAGE_OPTIONS.find((o) => o.value === lang) ?? LANGUAGE_OPTIONS[0]).value })} />
      <Choice label="Content region" note="Which country's charts and trending to show. Changing it reloads Home" value={labelFor(REGION_OPTIONS, region)} onPress={() => setContentLocale({ region: cycle(REGION_OPTIONS, REGION_OPTIONS.find((o) => o.value === region) ?? REGION_OPTIONS[0]).value })} />
      <Text style={st.section}>Lyrics sources</Text>
      {sources.map((s) => (
        <Toggle key={s.id} label={LABELS[s.id] ?? s.id} note={THIRD_PARTY_SOURCES.has(s.id) ? THIRD_PARTY_NOTE : undefined} on={s.enabled} onPress={() => toggleSource(s.id)} />
      ))}
      {updaterAvailable() ? <UpdatesSection /> : null}
      <Text style={st.about}>Sangeet {Constants.expoConfig?.version ?? ''} on Google TV</Text>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  content: { paddingTop: 30, paddingBottom: 80, paddingHorizontal: tv.gutter, maxWidth: 1000 },
  title: { color: '#fff', fontFamily: tv.font.extraBold, fontSize: 44, marginBottom: 20 },
  section: { color: '#fff', fontFamily: tv.font.bold, fontSize: 28, marginTop: 28, marginBottom: 10 },
  item: { flexDirection: 'row', alignItems: 'center', minHeight: 84, paddingHorizontal: 26, marginVertical: 5, borderRadius: 12, backgroundColor: tv.surface, borderWidth: 2, borderColor: 'transparent' },
  itemOn: { borderColor: '#fff', backgroundColor: tv.surfaceHigh },
  itemTitle: { color: '#fff', fontFamily: tv.font.bold, fontSize: 26 },
  itemValue: { color: tv.accent, fontFamily: tv.font.bold, fontSize: 26 },
  itemNote: { color: tv.textDim, fontFamily: tv.font.regular, fontSize: 19 },
  sw: { width: 76, height: 40, borderRadius: 20, backgroundColor: '#555', justifyContent: 'center', padding: 4 },
  swOn: { backgroundColor: tv.accent },
  knob: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },
  about: { color: tv.textDim, fontFamily: tv.font.medium, fontSize: 20, marginTop: 40 },
});
