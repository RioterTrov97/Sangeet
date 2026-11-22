import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { matchAll, type MatchResult } from '../import/match';
import { fetchSpotifyList, parseSpotifyLink, SpotifyError } from '../import/spotify';
import { createLocalPlaylist } from '../library/store';
import { log } from '../util/log';
import { search } from '../youtube/api';
import type { Track } from '../youtube/models';
import { openCustomSheet } from './sheet';

type Phase =
  | { kind: 'input'; error?: string }
  | { kind: 'loading' }
  | { kind: 'matching'; name: string; done: number; total: number; note?: string }
  | { kind: 'done'; name: string; playlistId?: string; imported: number; total: number; skipped: MatchResult[]; note?: string };

const MAX_SHOWN = 100;

/** Library `Import` pill and + menu: opens the Spotify import sheet. */
export const openSpotifyImport = () => openCustomSheet((close) => <ImportSheet close={close} />, { title: 'Import from Spotify' });

/** The same sheet with a link already filled in (a Spotify link shared to Sangeet from another app). */
export const openSpotifyImportFor = (link: string) => openCustomSheet((close) => <ImportSheet close={close} initial={link} />, { title: 'Import from Spotify' });

async function searchSongs(q: string): Promise<Track[]> {
  const page = await search(q, 'song');
  return page.items.filter((x): x is Track => x.kind === 'track');
}

function ImportSheet({ close, initial = '' }: { close: () => void; initial?: string }) {
  const { theme } = useUnistyles();
  const [text, setText] = useState(initial);
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const [showSkipped, setShowSkipped] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    void Clipboard.getStringAsync()
      .then((c) => alive && parseSpotifyLink(c) && setText((cur) => cur || c.trim()))
      .catch(() => {});
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, []);

  const start = async () => {
    const ref = parseSpotifyLink(text);
    if (!ref) return setPhase({ kind: 'input', error: 'That is not a Spotify playlist or album link' });
    const ac = new AbortController();
    abort.current = ac;
    setPhase({ kind: 'loading' });
    try {
      const list = await fetchSpotifyList(ref, ac.signal);
      if (!list.tracks.length) return setPhase({ kind: 'input', error: 'No songs found in that link' });
      const note = list.tracks.length >= 100 ? 'Spotify shares only the first 100 songs of a public link.' : undefined;
      setPhase({ kind: 'matching', name: list.name, done: 0, total: list.tracks.length, note });
      const results = await matchAll(list.tracks, searchSongs, { concurrency: 4, signal: ac.signal, onProgress: (done, total) => setPhase({ kind: 'matching', name: list.name, done, total, note }) });
      if (ac.signal.aborted) return setPhase({ kind: 'input' });
      const matched = results.flatMap((r) => (r.match ? [r.match] : []));
      const playlistId = matched.length ? createLocalPlaylist(list.name, matched) : undefined;
      log('import', `spotify ${ref.kind}: imported ${matched.length} of ${list.tracks.length}`);
      setPhase({ kind: 'done', name: list.name, playlistId, imported: matched.length, total: list.tracks.length, skipped: results.filter((r) => !r.match), note });
    } catch (e) {
      if (ac.signal.aborted) return setPhase({ kind: 'input' });
      setPhase({ kind: 'input', error: e instanceof SpotifyError ? e.message : 'Something went wrong. Try again' });
    }
  };
  const cancel = () => {
    abort.current?.abort();
    setPhase({ kind: 'input' });
  };

  if (phase.kind === 'input' || phase.kind === 'loading') {
    const loading = phase.kind === 'loading';
    return (
      <View style={styles.wrap}>
        <Text style={styles.hint}>Paste a Spotify playlist or album link</Text>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="https://open.spotify.com/playlist/…"
          placeholderTextColor={theme.colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void start()}
          editable={!loading}
          accessibilityLabel="Spotify link"
        />
        {phase.kind === 'input' && phase.error ? <Text style={styles.error}>{phase.error}</Text> : null}
        <Pressable style={[styles.button, (!text.trim() || loading) && styles.disabled]} disabled={!text.trim() || loading} onPress={() => void start()} accessibilityRole="button" accessibilityLabel="Import">
          {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Import</Text>}
        </Pressable>
        <Text style={styles.fine}>Only public links work. No Spotify account is used.</Text>
      </View>
    );
  }
  if (phase.kind === 'matching') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.name} numberOfLines={2}>{phase.name}</Text>
        <Text style={styles.progress} accessibilityLiveRegion="polite">{`Matching ${phase.done} / ${phase.total}`}</Text>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${Math.round((phase.done / Math.max(1, phase.total)) * 100)}%` }]} />
        </View>
        {phase.note ? <Text style={styles.fine}>{phase.note}</Text> : null}
        <Pressable style={styles.secondary} onPress={cancel} accessibilityRole="button" accessibilityLabel="Cancel import">
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <Text style={styles.name} numberOfLines={2}>{phase.name}</Text>
      <Text style={styles.progress}>{`Imported ${phase.imported} of ${phase.total} songs`}</Text>
      {phase.note ? <Text style={styles.fine}>{phase.note}</Text> : null}
      {phase.playlistId ? (
        <Pressable
          style={styles.button}
          onPress={() => {
            close();
            router.push({ pathname: '/local/[id]', params: { id: phase.playlistId! } });
          }}
          accessibilityRole="button"
          accessibilityLabel="Open playlist">
          <Text style={styles.buttonText}>Open playlist</Text>
        </Pressable>
      ) : null}
      {phase.skipped.length ? (
        <>
          <Pressable style={styles.secondary} onPress={() => setShowSkipped(!showSkipped)} accessibilityRole="button" accessibilityLabel="Show skipped songs">
            <Text style={styles.secondaryText}>{showSkipped ? 'Hide skipped' : `Show skipped (${phase.skipped.length})`}</Text>
          </Pressable>
          {showSkipped
            ? phase.skipped.slice(0, MAX_SHOWN).map((r, i) => (
                <Text key={i} style={styles.skipped} numberOfLines={1}>{`${r.src.title} - ${r.src.artists.join(', ')}`}</Text>
              ))
            : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.spacing.md },
  hint: { color: theme.colors.textSecondary, ...theme.typography.body },
  input: { height: 48, borderRadius: 16, paddingHorizontal: theme.spacing.lg, backgroundColor: theme.colors.surfaceElevated, color: theme.colors.text, ...theme.typography.body },
  error: { color: theme.colors.error, ...theme.typography.body },
  button: { height: 52, borderRadius: 26, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#000', ...theme.typography.heading },
  secondary: { height: 48, borderRadius: 24, backgroundColor: theme.colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: theme.colors.text, ...theme.typography.heading },
  fine: { color: theme.colors.textSecondary, ...theme.typography.caption },
  name: { color: theme.colors.text, ...theme.typography.heading },
  progress: { color: theme.colors.text, ...theme.typography.title },
  bar: { height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceElevated, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: theme.colors.accent },
  skipped: { color: theme.colors.textSecondary, ...theme.typography.body },
}));
