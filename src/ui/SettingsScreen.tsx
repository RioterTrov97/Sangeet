import Constants from 'expo-constants';
import Animated from 'react-native-reanimated';
import { Pressable, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useState } from 'react';

import { setReportHistory, signOut, syncYtLibrary, useAuth } from '../auth/store';
import { removeAllDownloads, usedBytes, useDownloads } from '../downloads/manager';
import { gbToBytes, LIMIT_OPTIONS_GB } from '../downloads/lru';
import { setForcedOffline, useNet } from '../downloads/net';
import { clearAutoCache, useAutoCache } from '../downloads/autoCache';
import { AUTO_CACHE_OPTIONS_MB, setDownloadSettings, useDownloadSettings } from '../downloads/settings';
import { AUDIO_LABEL, AUDIO_QUALITIES, VIDEO_LABEL, VIDEO_QUALITIES, type AudioQuality, type VideoQuality } from '../youtube/formats';
import { LANGUAGE_OPTIONS, REGION_OPTIONS, labelFor, setContentLocale, useContentLocale } from '../youtube/contentLocale';
import { setQuality, useQuality } from '../youtube/resolver/qualitySettings';
import { useStreamInfo } from '../youtube/resolver/streamInfo';
import { usePlayerStore } from '../player/store';
import { PROVIDERS } from '../lyrics';
import { THIRD_PARTY_NOTE, THIRD_PARTY_SOURCES, moveSource, toggleSource, useLyricsSources } from '../lyrics/settings';
import { BackupServerNote, BackupServerSection, DegradedBanner } from './BackupServerSection';
import { IconButton } from './Controls';
import { useScrollY } from './scroll';
import { Image } from 'expo-image';
import { APP_ICONS, chooseIcon, currentIcon, iconsSupported } from './appIcon';
import { setMatchColors, usePaletteStore } from './palette/store';
import { setAllowLyric, useVideoSettings } from '../video/settings';
import { Header, Screen, useScreenTop } from './Layout';
import { confirmSheet } from './sheet';


const fmtBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

function AccountNote() {
  const status = useAuth((s) => s.status);
  return <Text style={styles.note}>{status === 'signedIn' ? 'Signed in' : status === 'expired' ? 'Expired' : 'Not signed in'}</Text>;
}

function AccountSection() {
  const { theme } = useUnistyles();
  const { status, reportHistory, syncing } = useAuth();
  return (
    <View style={styles.about}>
      {status === 'signedIn' ? (
        <>
          <Text style={styles.aboutText}>Signed in to YouTube Music. Home is personalised and your playlists, liked songs and artists appear in Library. Likes sync to your account.</Text>
          <View style={styles.srcRow}>
            <Text style={styles.title}>Add played songs to YouTube history</Text>
            <Switch value={reportHistory} onValueChange={setReportHistory} accessibilityLabel="Report playback to YouTube history" trackColor={{ true: theme.colors.accent }} />
          </View>
          <Pressable style={styles.btn} onPress={() => void syncYtLibrary()} accessibilityRole="button" accessibilityLabel="Sync library now">
            <Text style={styles.btnText}>{syncing ? 'Syncing…' : 'Sync library now'}</Text>
          </Pressable>
          <Pressable
            style={styles.btn}
            onPress={() => confirmSheet({ title: 'Sign out?', text: 'This removes the YouTube Music rows from your library and returns to anonymous mode. Local likes, playlists and downloads stay.', label: 'Sign out', icon: 'rectangle.portrait.and.arrow.right', onConfirm: () => void signOut() })}
            accessibilityRole="button"
            accessibilityLabel="Sign out">
            <Text style={[styles.btnText, { color: theme.colors.error }]}>Sign out</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.aboutText}>
            {status === 'expired' ? 'Your session expired. Sign in again to restore your personalised Home and library. Everything else keeps working.' : 'Optional. Sign in with Google for a personalised Home, your YouTube Music library and synced likes. Playback never needs an account.'}
          </Text>
          <Pressable style={styles.btn} onPress={() => router.push('/signin')} accessibilityRole="button" accessibilityLabel="Sign in with Google">
            <Text style={styles.btnText}>Sign in with Google</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function DownloadsNote() {
  const used = useDownloads((s) => (s.rev, usedBytes()));
  return <Text style={styles.note}>{fmtBytes(used)}</Text>;
}

function Pills<T extends string>({ label, options, labels, value, onPick }: { label: string; options: readonly T[]; labels: Record<string, string>; value: T; onPick: (v: T) => void }) {
  return (
    <>
      <Text style={styles.title}>{label}</Text>
      <View style={styles.pills}>
        {options.map((o) => (
          <Pressable key={o} onPress={() => onPick(o)} style={[styles.pill, value === o && styles.pillOn]} accessibilityRole="button" accessibilityState={{ selected: value === o }} accessibilityLabel={`${label} ${labels[o]}`}>
            <Text style={[styles.pillText, value === o && styles.pillTextOn]}>{labels[o]}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

function ContentSection() {
  const { lang, region } = useContentLocale();
  const pick = (list: typeof LANGUAGE_OPTIONS, cur: string | undefined, label: string, set: (v: string | undefined) => void) => (
    <>
      <Text style={styles.title}>{label}</Text>
      <View style={styles.pills}>
        {list.map((o) => (
          <Pressable key={o.label} onPress={() => set(o.value)} style={[styles.pill, cur === o.value && styles.pillOn]} accessibilityRole="button" accessibilityState={{ selected: cur === o.value }} accessibilityLabel={`${label} ${o.label}`}>
            <Text style={[styles.pillText, cur === o.value && styles.pillTextOn]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
  return (
    <View style={styles.about}>
      {pick(LANGUAGE_OPTIONS, lang, 'Content language', (v) => setContentLocale({ lang: v }))}
      {pick(REGION_OPTIONS, region, 'Content region', (v) => setContentLocale({ region: v }))}
      <Text style={styles.aboutText}>Language and region of what YouTube Music shows on Home, charts and search ({labelFor(LANGUAGE_OPTIONS, lang)}, {labelFor(REGION_OPTIONS, region)}). Changing it reloads Home.</Text>
    </View>
  );
}

function QualitySection() {
  const q = useQuality();
  const nowId = usePlayerStore((s) => s.queue[s.index]?.id);
  const now = useStreamInfo((s) => (nowId ? s.byId[nowId] : undefined));
  const lyricVideos = useVideoSettings((v) => v.allowLyric);
  const { theme } = useUnistyles();
  const mobileAudio = { same: 'Same as Wi-Fi', ...AUDIO_LABEL } as Record<string, string>;
  const mobileVideo = { same: 'Same as Wi-Fi', ...VIDEO_LABEL } as Record<string, string>;
  return (
    <View style={styles.about}>
      <Pills<AudioQuality> label="Audio quality" options={AUDIO_QUALITIES} labels={AUDIO_LABEL} value={q.audio} onPick={(v) => setQuality({ audio: v })} />
      <Text style={styles.aboutText}>{now ? `Now playing: ${now}. ` : ''}iPhone plays AAC only: Maximum is the best AAC YouTube offers (usually 128 kbps, 256 kbps when available). Applies from the next song.</Text>
      <Pills<VideoQuality> label="Video quality" options={VIDEO_QUALITIES} labels={VIDEO_LABEL} value={q.video} onPick={(v) => setQuality({ video: v })} />
      <Text style={styles.aboutText}>Maximum plays up to 1080p. Applies from the next video.</Text>
      <View style={styles.srcRow}>
        <Text style={styles.title}>Use lyric videos when there is no music video</Text>
        <Switch value={lyricVideos} onValueChange={setAllowLyric} accessibilityLabel="Use lyric videos when there is no music video" trackColor={{ true: theme.colors.accent }} />
      </View>
      <Text style={styles.aboutText}>Only a lyric video of the same song by the same artist is used. Change the video of one song from the player menu, Choose video.</Text>
      <Pills<AudioQuality | 'same'> label="Audio on mobile data" options={['same', ...AUDIO_QUALITIES]} labels={mobileAudio} value={q.audioMobile} onPick={(v) => setQuality({ audioMobile: v })} />
      <Pills<VideoQuality | 'same'> label="Video on mobile data" options={['same', ...VIDEO_QUALITIES]} labels={mobileVideo} value={q.videoMobile} onPick={(v) => setQuality({ videoMobile: v })} />
    </View>
  );
}

function DownloadsSection() {
  const { theme } = useUnistyles();
  const st = useDownloadSettings();
  const used = useDownloads((s) => (s.rev, usedBytes()));
  const forced = useNet((s) => s.forcedOffline);
  const autoUsed = useAutoCache((s) => s.bytes);
  return (
    <View style={styles.about}>
      <Text style={styles.aboutText}>Downloads use the Audio quality setting above (AAC on iPhone).</Text>
      <View style={styles.srcRow}>
        <Text style={styles.title}>Wi-Fi only</Text>
        <Switch value={st.wifiOnly} onValueChange={(v) => setDownloadSettings({ wifiOnly: v })} accessibilityLabel="Download on Wi-Fi only" trackColor={{ true: theme.colors.accent }} />
      </View>
      <View style={styles.srcRow}>
        <Text style={styles.title}>Auto-download Liked Songs</Text>
        <Switch value={st.autoDownloadLiked} onValueChange={(v) => setDownloadSettings({ autoDownloadLiked: v })} accessibilityLabel="Auto-download Liked Songs" trackColor={{ true: theme.colors.accent }} />
      </View>
      <Text style={styles.title}>Automatic offline storage</Text>
      <View style={styles.pills}>
        {AUTO_CACHE_OPTIONS_MB.map((mb) => (
          <Pressable key={mb} onPress={() => setDownloadSettings({ autoCacheMb: mb })} style={[styles.pill, st.autoCacheMb === mb && styles.pillOn]} accessibilityRole="button" accessibilityState={{ selected: st.autoCacheMb === mb }} accessibilityLabel={mb ? `Automatic offline storage ${mb >= 1024 ? mb / 1024 + ' GB' : mb + ' MB'}` : 'Automatic offline storage off'}>
            <Text style={[styles.pillText, st.autoCacheMb === mb && styles.pillTextOn]}>{mb ? (mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`) : 'Off'}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.aboutText}>
        {`Songs you play are saved whole so they replay instantly and work offline. Used: ${fmtBytes(autoUsed)}. When full, songs you played once are removed first, then the least played; liked and often played songs stay longest. Songs you download yourself are not counted and never removed.`}
      </Text>
      {autoUsed > 0 ? (
        <Pressable style={styles.btn} onPress={clearAutoCache} accessibilityRole="button" accessibilityLabel="Clear automatically saved songs">
          <Text style={[styles.btnText, { color: theme.colors.error }]}>Clear automatically saved songs</Text>
        </Pressable>
      ) : null}
      <Text style={styles.title}>Storage limit</Text>
      <View style={styles.pills}>
        {LIMIT_OPTIONS_GB.map((gb) => (
          <Pressable key={gb} onPress={() => setDownloadSettings({ limitGb: gb })} style={[styles.pill, st.limitGb === gb && styles.pillOn]} accessibilityRole="button" accessibilityState={{ selected: st.limitGb === gb }} accessibilityLabel={gb ? `${gb} GB limit` : 'No limit'}>
            <Text style={[styles.pillText, st.limitGb === gb && styles.pillTextOn]}>{gb ? `${gb} GB` : 'None'}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.aboutText}>
        {`Used: ${fmtBytes(used)}${st.limitGb ? ` of ${fmtBytes(gbToBytes(st.limitGb))}` : ''}. Over the limit, auto-downloaded songs are removed least recently played first. Songs you download yourself are kept.`}
      </Text>
      <Pressable
        style={styles.btn}
        onPress={() => confirmSheet({ title: 'Remove all downloads?', text: 'Downloaded songs are deleted from this device.', label: 'Remove all', onConfirm: removeAllDownloads })}
        accessibilityRole="button"
        accessibilityLabel="Remove all downloads">
        <Text style={[styles.btnText, { color: theme.colors.error }]}>Remove all downloads</Text>
      </Pressable>
      {__DEV__ ? (
        <View style={styles.srcRow}>
          <Text style={styles.title}>Developer: force offline</Text>
          <Switch value={forced} onValueChange={setForcedOffline} accessibilityLabel="Force offline mode" trackColor={{ true: theme.colors.accent }} />
        </View>
      ) : null}
    </View>
  );
}

function AppIconPicker() {
  const [sel, setSel] = useState(currentIcon());
  return (
    <View style={styles.iconBlock}>
      <Text style={styles.title}>App Icon</Text>
      <View style={styles.iconRow}>
        {APP_ICONS.map((ic) => (
          <Pressable key={ic.id} onPress={() => void chooseIcon(ic.id).then(() => setSel(ic.id)).catch(() => {})} accessibilityRole="button" accessibilityState={{ selected: sel === ic.id }} accessibilityLabel={`App icon ${ic.label}`} style={styles.iconCell}>
            <Image source={ic.preview} style={[styles.iconImg, sel === ic.id && styles.iconSel]} />
            <Text style={styles.iconLabel} numberOfLines={1}>{ic.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.aboutText}>iOS shows its own confirmation when the icon changes.</Text>
    </View>
  );
}

function AppearanceSection() {
  const { theme } = useUnistyles();
  const match = usePaletteStore((s) => s.matchColors);
  return (
    <View style={styles.indent}>
      <View style={styles.srcRow}>
        <Text style={styles.title}>Match colours to music</Text>
        <Switch value={match} onValueChange={setMatchColors} accessibilityLabel="Match colours to music" trackColor={{ true: theme.colors.accent }} />
      </View>
      <Text style={styles.aboutText}>Tints the player, lyrics and mini-player with the artwork colours. Off keeps the static green theme.</Text>
      {iconsSupported() ? <AppIconPicker /> : null}
    </View>
  );
}

const LICENSES = ['Expo and React Native (MIT)', 'react-native-nitro-player (MIT)', 'youtubei.js (MIT)', 'TanStack Query (MIT)', 'Unistyles (MIT)', 'Reanimated and Gesture Handler (MIT)', 'FlashList (MIT)', 'Figtree typeface (SIL OFL 1.1)', 'Lyrics: LRCLIB (lrclib.net) and YouTube Music'];

export function SettingsScreen() {
  const { theme } = useUnistyles();
  const { scrollY, onScroll } = useScrollY();
  const [about, setAbout] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const sources = useLyricsSources((s) => s.sources);
  const topInset = useScreenTop('header');
  const [accountOpen, setAccountOpen] = useState(true);
  const [dlOpen, setDlOpen] = useState(true);
  const [serverOpen, setServerOpen] = useState(false);
  return (
    <Screen top="header" mini>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={[styles.content, { paddingTop: topInset }]}>
        <DegradedBanner />
        <View style={styles.row} accessible={false}>
          <SymbolView name="waveform" size={22} tintColor={theme.colors.textSecondary} style={styles.icon} />
          <Text style={styles.title}>Playback quality</Text>
        </View>
        <QualitySection />
        <View style={styles.row} accessible={false}>
          <SymbolView name="globe" size={22} tintColor={theme.colors.textSecondary} style={styles.icon} />
          <Text style={styles.title}>Content language and region</Text>
        </View>
        <ContentSection />
        <Pressable style={styles.row} onPress={() => setServerOpen(!serverOpen)} accessibilityRole="button" accessibilityLabel="Backup server">
          <SymbolView name="externaldrive.connected.to.line.below" size={22} tintColor={theme.colors.textSecondary} style={styles.icon} />
          <Text style={styles.title}>Backup server</Text>
          <BackupServerNote />
        </Pressable>
        {serverOpen ? <BackupServerSection /> : null}
        <Pressable style={styles.row} onPress={() => router.push('/diagnostics')} accessibilityRole="button" accessibilityLabel="Diagnostics">
          <SymbolView name="doc.text.magnifyingglass" size={22} tintColor={theme.colors.textSecondary} style={styles.icon} />
          <Text style={styles.title}>Diagnostics</Text>
          <Text style={styles.note}>Logs, health</Text>
        </Pressable>
        <View style={styles.row} accessible={false}>
          <SymbolView name="paintpalette" size={22} tintColor={theme.colors.textSecondary} style={styles.icon} />
          <Text style={styles.title}>Appearance</Text>
        </View>
        <AppearanceSection />
        <Pressable style={styles.row} onPress={() => setAccountOpen(!accountOpen)} accessibilityRole="button" accessibilityLabel="Account">
          <SymbolView name="person.crop.circle" size={22} tintColor={theme.colors.textSecondary} style={styles.icon} />
          <Text style={styles.title}>Account</Text>
          <AccountNote />
        </Pressable>
        {accountOpen ? <AccountSection /> : null}
        <Pressable style={styles.row} onPress={() => setDlOpen(!dlOpen)} accessibilityRole="button" accessibilityLabel="Downloads">
          <SymbolView name="arrow.down.circle" size={22} tintColor={theme.colors.textSecondary} style={styles.icon} />
          <Text style={styles.title}>Downloads</Text>
          <DownloadsNote />
        </Pressable>
        {dlOpen ? <DownloadsSection /> : null}
        <Pressable style={styles.row} onPress={() => setLyricsOpen(!lyricsOpen)} accessibilityRole="button" accessibilityLabel="Lyrics sources">
          <SymbolView name="music.quarternote.3" size={22} tintColor={theme.colors.textSecondary} style={styles.icon} />
          <Text style={styles.title}>Lyrics sources</Text>
          <Text style={styles.note}>{sources.filter((x) => x.enabled).length} on</Text>
        </Pressable>
        {lyricsOpen ? (
          <View style={styles.about}>
            <Text style={styles.aboutText}>Tried in this order until one has lyrics.</Text>
            {sources.map((src, i) => (
              <View key={src.id}>
              <View style={styles.srcRow}>
                <Text style={styles.title}>{PROVIDERS[src.id].label}</Text>
                <IconButton name="chevron.up" size={18} label={`Move ${PROVIDERS[src.id].label} up`} onPress={() => i > 0 && moveSource(src.id, -1)} style={i === 0 && styles.dim} />
                <IconButton name="chevron.down" size={18} label={`Move ${PROVIDERS[src.id].label} down`} onPress={() => i < sources.length - 1 && moveSource(src.id, 1)} style={i === sources.length - 1 && styles.dim} />
                <Switch value={src.enabled} onValueChange={() => toggleSource(src.id)} accessibilityLabel={`Use ${PROVIDERS[src.id].label}`} trackColor={{ true: theme.colors.accent }} />
              </View>
              {THIRD_PARTY_SOURCES.has(src.id) ? <Text style={styles.srcNote}>{THIRD_PARTY_NOTE}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
        <Pressable style={styles.row} onPress={() => setAbout(!about)} accessibilityRole="button" accessibilityLabel="About and licenses">
          <SymbolView name="info.circle" size={22} tintColor={theme.colors.textSecondary} style={styles.icon} />
          <Text style={styles.title}>About and licenses</Text>
          <Text style={styles.note}>v{Constants.expoConfig?.version ?? '0.1.0'}</Text>
        </Pressable>
        {about ? (
          <View style={styles.about}>
            <Text style={styles.aboutText}>Sangeet is a personal, open-source music player. Not affiliated with any streaming service.</Text>
            {LICENSES.map((l) => (
              <Text key={l} style={styles.aboutText}>
                {l}
              </Text>
            ))}
          </View>
        ) : null}
      </Animated.ScrollView>
      <Header title="Settings" scrollY={scrollY} back inline />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { paddingBottom: theme.spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg },
  icon: { width: 24, height: 24 },
  title: { flex: 1, color: theme.colors.text, ...theme.typography.bodyLarge },
  note: { color: theme.colors.textTertiary, ...theme.typography.body },
  srcNote: { color: theme.colors.textSecondary, ...theme.typography.caption },
  srcRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg, paddingVertical: theme.spacing.sm },
  dim: { opacity: 0.3 },
  iconBlock: { gap: 8, marginTop: 8 },
  iconRow: { flexDirection: 'row', gap: 12 },
  iconCell: { flex: 1, alignItems: 'center', gap: 6 },
  iconImg: { width: 64, height: 64, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
  iconSel: { borderColor: '#fff' },
  iconLabel: { color: theme.colors.textSecondary, ...theme.typography.caption, textAlign: 'center' },
  indent: { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm },
  about: { paddingHorizontal: theme.spacing.lg, gap: theme.spacing.sm },
  btn: { alignSelf: 'flex-start', paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.md, borderRadius: theme.radii.full, backgroundColor: theme.colors.surfaceElevated },
  btnText: { color: theme.colors.text, ...theme.typography.heading },
  pills: { flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' },
  pill: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm, borderRadius: theme.radii.full, backgroundColor: theme.colors.surfaceElevated },
  pillOn: { backgroundColor: theme.colors.accent },
  pillText: { color: theme.colors.text, ...theme.typography.body },
  pillTextOn: { color: '#000' },
  aboutText: { color: theme.colors.textSecondary, ...theme.typography.body },
}));
