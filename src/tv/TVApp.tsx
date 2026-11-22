import { Figtree_400Regular, Figtree_500Medium, Figtree_700Bold, Figtree_800ExtraBold } from '@expo-google-fonts/figtree';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, AppState, Easing, BackHandler, StyleSheet, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { onNavKey, onTvKey } from '../../modules/tv-keys';
import { seekTo, skipNext, skipPrevious, togglePlay } from '../player';
import { playerState, usePlayerStore } from '../player/store';
import { backgroundPolicy } from '../player/videoFlag';
import { startRemoteHost } from '../remote/host';
import { queryClient } from '../youtube/queryClient';
import { markActivity, remoteWakeActive } from './activity';
import { log } from '../util/log';
import { backgroundSustained } from '../util/sustain';
import { runBack } from './back';
import { AlbumTV, ArtistTV, LikedTV, PlaylistTV } from './DetailTV';
import { HomeTV } from './HomeTV';
import { Icon, type IconName } from './icons';
import { LibraryTV } from './LibraryTV';
import { setBeforeLeaveRoot, setBeforeShowRoot, tvNav, useTvNav, type Route } from './nav';
import { ScreenActive } from './screenActive';
import { NowPlayingTV } from './NowPlayingTV';
import { MirrorPublisher } from './MirrorPublisher';
import { RemoteOverlay } from './RemoteOverlay';
import { SearchTV } from './SearchTV';
import { SettingsTV } from './SettingsTV';
import { ShelvesTV } from './ShelvesTV';
import { tv } from './theme';
import { ExitDialog } from './ExitDialog';
import { prefetchLibraryArt } from './prefetch';
import { backgroundPlay } from './playerPrefs';
import { DESIGN_W, useTvWindow } from './scale';
import { contentFocusSnapshot, Focusable, reclaimContentFocus, type ContentFocus } from './ui';
import { perfOn, setPerfScreen } from '../util/perfMode';
import { initialRail, railReduce, type RailEvent, type RailState } from './railState';

const RAIL: { name: 'home' | 'search' | 'library' | 'now' | 'settings'; label: string; icon: IconName }[] = [
  { name: 'home', label: 'Home', icon: 'home' },
  { name: 'search', label: 'Search', icon: 'search' },
  { name: 'library', label: 'Library', icon: 'library' },
  { name: 'now', label: 'Now Playing', icon: 'now' },
  { name: 'settings', label: 'Settings', icon: 'settings' },
];

const RAIL_IDLE_MS = 10_000;
const KEY_LATE_MS = 150;
const now = (): number => Date.now();

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomeTV />;
    case 'search':
      return <SearchTV />;
    case 'library':
      return <LibraryTV />;
    case 'now':
      return <NowPlayingTV />;
    case 'settings':
      return <SettingsTV />;
    case 'album':
      return <AlbumTV id={route.id} />;
    case 'playlist':
      return <PlaylistTV id={route.id} />;
    case 'artist':
      return <ArtistTV id={route.id} />;
    case 'liked':
      return <LikedTV />;
    case 'mood':
      return <ShelvesTV params={route.params} title={route.title} />;
  }
}

/** Left rail: icons only, expanding with labels while it holds focus. Overlays the content so nothing reflows. */
function Rail({ current }: { current: string }) {
  // When it is open is decided by `railReduce` (see railState.ts): only focus the user asked for (a D-pad key a moment
  // ago) opens it; focus the system moved in (a focused view unmounted) leaves it shut and goes back to the content.
  const st_ = useRef<RailState>(initialRail);
  const [open, setOpen] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Focus entering the rail from the content always lands on the current destination, whichever item was nearest.
  const [pref, setPref] = useState<string | undefined>();
  // Left open with no key presses, the rail folds itself away after RAIL_IDLE_MS (focus stays on the item, as after a choice).
  const focused = useRef<string | undefined>(undefined);
  const [moved, setMoved] = useState(0);
  const pending = useRef<{ name: string; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
  // Expand/collapse is two native-driven fades (the panel behind the items and the labels). The layout stays open until a
  // fold's fade has finished, so nothing jumps while it runs and no layout work happens per frame.
  const [p] = useState(() => new Animated.Value(0));
  const [folded, setFolded] = useState(true);
  useEffect(() => {
    if (open) {
      Animated.timing(p, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(p, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    const id = setTimeout(() => setFolded(true), 240);
    return () => clearTimeout(id);
  }, [open, p]);
  const layoutOpen = open || !folded;
  const apply = useCallback((e: RailEvent) => {
    const r = railReduce(st_.current, e);
    st_.current = r.state;
    setOpen(r.state.open);
    if (r.state.open) setFolded(false);
    return r;
  }, []);
  useEffect(() => {
    const sub = onNavKey(() => {
      apply({ type: 'key', at: now() });
      // The key event can trail the focus event it caused (two channels): a focus held back waiting for it opens the rail now.
      const p = pending.current;
      if (p) {
        clearTimeout(p.timer);
        pending.current = undefined;
        apply({ type: 'focus', name: p.name, at: now() });
        if (perfOn()) console.log('[focus] rail opened (key arrived after focus)');
      }
    });
    return () => sub.remove();
  }, [apply]);
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => apply({ type: 'idle', focused: focused.current }), RAIL_IDLE_MS);
    return () => clearTimeout(id);
  }, [open, moved, apply]);
  const focus = (name: string) => {
    clearTimeout(t.current);
    focused.current = name;
    setMoved((n) => n + 1);
    const was = st_.current.open;
    const r = apply({ type: 'focus', name, at: now() });
    if (r.reclaim) {
      clearTimeout(pending.current?.timer);
      pending.current = {
        name,
        timer: setTimeout(() => {
          pending.current = undefined;
          const back = reclaimContentFocus();
          if (perfOn()) console.log(`[focus] rail ignored: system moved focus to ${name}, ${back ? 'content takes it back' : 'content is gone'}`);
        }, KEY_LATE_MS),
      };
      return;
    }
    if (!was && st_.current.open && name !== current) setPref(current);
    else if (name === pref) setPref(undefined);
    if (perfOn() && !was !== !st_.current.open) console.log(`[focus] rail ${st_.current.open ? 'opened' : 'closed'}`);
  };
  const blur = () => {
    apply({ type: 'blur' });
    clearTimeout(t.current);
    t.current = setTimeout(() => {
      apply({ type: 'close' });
      if (perfOn()) console.log('[focus] rail closed');
    }, 80);
  };
  return (
    <View style={[st.rail, { width: layoutOpen ? tv.railOpen : tv.railCol }]}>
      <Animated.View pointerEvents="none" style={[st.railPanel, { opacity: p }]} />
      {RAIL.map((r) => (
        <Focusable key={r.name} onPress={() => { clearTimeout(t.current); apply({ type: 'choose', name: r.name }); tvNav().root({ name: r.name }); }} onFocus={() => focus(r.name)} onBlur={blur} preferred={pref === r.name} label={r.label} zone="rail" scale={1.0} style={[st.railItem, layoutOpen ? st.railItemOpen : st.railItemShut, current === r.name && st.railCurrent]} focusedStyle={st.railFocus}>
          {(f) => (
            <>
              <Icon name={r.icon} size={34} color={f ? '#000' : current === r.name ? tv.accent : '#fff'} />
              {layoutOpen ? <Animated.Text style={[st.railLabel, f && { color: '#000' }, { opacity: p }]}>{r.label}</Animated.Text> : null}
            </>
          )}
        </Focusable>
      ))}
    </View>
  );
}

function useBackAndKeys(askExit: () => void) {
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      markActivity();
      // A screen's overlays (layout picker, Up next) close before the screen is left; Now Playing returns to audio when it unmounts.
      if (runBack()) return true;
      const nav = tvNav();
      if (nav.pop()) return true;
      if (nav.stack[0].name !== 'home') {
        nav.root({ name: 'home' });
        return true;
      }
      askExit();
      return true;
    });
    const keys = onTvKey(({ key, repeat }) => {
      markActivity();
      if (repeat > 0 && key !== 'fast_forward' && key !== 'rewind') return;
      const playing = ['playing', 'buffering'].includes(playerState().status);
      if (key === 'play_pause') void togglePlay();
      else if (key === 'play') !playing && void togglePlay();
      else if (key === 'pause') playing && void togglePlay();
      else if (key === 'next') void skipNext();
      else if (key === 'previous') void skipPrevious();
      else if (key === 'fast_forward') void seekTo(playerState().position + 10);
      else if (key === 'rewind') void seekTo(Math.max(0, playerState().position - 10));
    });
    return () => {
      back.remove();
      keys.remove();
    };
  }, [askExit]);
}

/**
 * Leaving the foreground (Home, another app, input change) pauses playback unless "Keep playing in background" is on, but
 * never when a remote command just started playback (it is bringing us to the front itself).
 * The screen stays awake while playing, and while Now Playing is open even when paused (someone may be reading lyrics);
 * with nothing playing and not on Now Playing the system may sleep normally. There is no app-side dimming.
 */
function useBackgroundPolicy() {
  useEffect(() => void (backgroundPolicy.keepPlaying = () => backgroundPlay() || remoteWakeActive()), []);
  useEffect(() => {
    // Debounced: an intent delivered to the running activity (or an overlay) fires onPause for a moment; only a lasting background pauses the music.
    const sustained = backgroundSustained(() => {
      if (backgroundPlay()) return;
      if (remoteWakeActive()) return void log('tv', 'background event ignored: a remote command is bringing the app forward');
      if (['playing', 'buffering'].includes(playerState().status)) void togglePlay();
    });
    const sub = AppState.addEventListener('change', sustained);
    return () => {
      sub.remove();
      sustained.cancel();
    };
  }, []);
  const playing = usePlayerStore((s) => s.status === 'playing' || s.status === 'buffering');
  const onNow = useTvNav((s) => s.stack[s.stack.length - 1].name === 'now');
  const awake = playing || onNow;
  useEffect(() => {
    if (!awake) return;
    void activateKeepAwakeAsync('sangeet-tv-awake').catch(() => {});
    return () => void deactivateKeepAwake('sangeet-tv-awake').catch(() => {});
  }, [awake]);
}

export function TVApp() {
  const [loaded, error] = useFonts({ Figtree_400Regular, Figtree_500Medium, Figtree_700Bold, Figtree_800ExtraBold });
  const stack = useTvNav((s) => s.stack);
  const [exitOpen, setExitOpen] = useState(false);
  const askExit = useCallback(() => setExitOpen(true), []);
  useBackAndKeys(askExit);
  useBackgroundPolicy();

  useEffect(() => startRemoteHost(), []);
  useEffect(() => prefetchLibraryArt(), []);
  if (!loaded && !error) return null;
  const route = stack[stack.length - 1];
  setPerfScreen(route.name);
  const full = route.name === 'now';
  // Root screens (Home / Search / Library / Settings) are kept alive like tabs: each mounts on its first visit and then stays
  // mounted, hidden with `display: none` (which also takes it out of D-pad focus), under another root or a pushed screen. Going
  // back or switching with the rail just reveals it, with its last focused item claimed in the same render. Now Playing is
  // never kept. Pushed screens (album, playlist...) are rebuilt as before.
  const covered = stack.length > 1;
  const rootName = stack[0].name;
  return (
    <GestureHandlerRootView style={st.root}>
      <Scaled>
      <QueryClientProvider client={queryClient}>
        <KeptRoots rootName={rootName} covered={covered} top={route} />
        {full ? null : <Rail current={stack[0].name} />}
        <RemoteOverlay />
        <MirrorPublisher />
        {exitOpen ? <ExitDialog onStay={() => setExitOpen(false)} /> : null}
      </QueryClientProvider>
      </Scaled>
    </GestureHandlerRootView>
  );
}

/** Which roots are kept alive; others (Now Playing) mount only while on top. */
const KEPT = ['home', 'search', 'library', 'settings'];
export const isKeptRoot = (name: string): boolean => KEPT.includes(name);

/** Mounts each kept root on its first visit and keeps it; remembers and re-claims each root's last focus. */
function KeptRoots({ rootName, covered, top }: { rootName: string; covered: boolean; top: Route }) {
  const [visited, setVisited] = useState<string[]>(() => (isKeptRoot(rootName) ? [rootName] : []));
  if (isKeptRoot(rootName) && !visited.includes(rootName)) setVisited([...visited, rootName]);
  const saved = useRef(new Map<string, ContentFocus>());
  useEffect(() => {
    setBeforeLeaveRoot((name) => {
      const c = contentFocusSnapshot();
      if (c && isKeptRoot(name)) saved.current.set(name, c);
    });
    setBeforeShowRoot((name) => {
      const c = saved.current.get(name);
      if (!c || !c.claim()) return;
      setTimeout(c.release, 400);
    });
    return () => {
      setBeforeLeaveRoot(undefined);
      setBeforeShowRoot(undefined);
    };
  }, []);
  const full = top.name === 'now';
  const pad = { paddingLeft: full ? 0 : tv.rail };
  return (
    <View style={[st.content, pad]}>
      {visited.map((name) => {
        const shown = !covered && name === rootName;
        return (
          <View key={name} style={shown ? st.content : st.hidden}>
            <ScreenActive.Provider value={shown}>
              <Screen route={{ name } as Route} />
            </ScreenActive.Provider>
          </View>
        );
      })}
      {covered || !isKeptRoot(rootName) ? <Screen key={JSON.stringify(top)} route={top} /> : null}
    </View>
  );
}

/** Lays the children out in the 1440-wide design space and scales that to the real window. */
function Scaled({ children }: { children: ReactNode }) {
  const { height, scale } = useTvWindow();
  return (
    <View style={st.root}>
      <View style={{ position: 'absolute', left: 0, top: 0, width: DESIGN_W, height, transformOrigin: 'top left', transform: [{ scale }] }}>{children}</View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: tv.bg },
  content: { flex: 1 },
  hidden: { display: 'none' },
  // Above everything in the content (a focused card is scaled and shadowed), for the whole expand and fold.
  rail: { position: 'absolute', left: 0, top: 0, bottom: 0, paddingVertical: 24, justifyContent: 'center', gap: 10, zIndex: 50, elevation: 50 },
  railPanel: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(24,24,28,0.9)', borderTopRightRadius: 28, borderBottomRightRadius: 28, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.14)' },
  // Collapsed: a 56px circle with the 34px icon centred. Open: the same circle grows right into a pill; the icon keeps its x.
  railItem: { flexDirection: 'row', alignItems: 'center', gap: 20, height: 56, marginLeft: (tv.railCol - 56) / 2, paddingHorizontal: 11, borderRadius: 28 },
  railItemShut: { width: 56 },
  railItemOpen: { marginRight: 16 },
  railCurrent: { backgroundColor: 'rgba(255,255,255,0.08)' },
  railFocus: { backgroundColor: '#fff' },
  railLabel: { color: '#fff', fontFamily: tv.font.bold, fontSize: 24 },
});
