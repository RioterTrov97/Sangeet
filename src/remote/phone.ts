import * as Device from 'expo-device';
import { TrackPlayer } from 'react-native-nitro-player';
import { create } from 'zustand';

import { browseTvs, dial, randomHex } from '../../modules/sangeet-remote';
import { isLocalId } from '../local/id';
import { remoteRoute, type RemoteHandlers } from '../player/remoteFlag';
import { playerState, setPlayerState } from '../player/store';
import { clearNotice, showNotice } from '../util/notice';
import { log, logWarn } from '../util/log';
import { storage } from '../util/storage';
import { exitVideo } from '../video/controller';
import { videoFlag } from '../player/videoFlag';
import { RemoteClient } from './client';
import { HOLD_MAX_REMOTE_MS, seekHoldActive, seekHoldDrops, startSeekHold } from '../player/seekHold';
import { applyTick, applyTvState, localAfterLeave, reportsSongTime, shouldHandOver, songPositionOf } from './mirror';
import { applyStatusHold, reportClock, startStatusHold, stepClock, type StatusHold } from './phoneClock';
import { layoutForSwitch, usesVideo } from '../player/layout';
import { lastVideoLyrics, rememberVideoLyrics } from '../tv/playerPrefs';
import { isRemoteLayout, SILENCE_MS, toWire, type ClientMsg, type PlayStatus, type RemoteLayout, type RemoteMode, type ServerMsg, type TvSnapshot } from './protocol';

/**
 * Phone side of the remote: discovery, connection (with auto-reconnect inside the session) and the
 * remote-mode switch of the player store. While `status` is not 'off', the store mirrors the TV.
 */
export type RemoteStatus = 'off' | 'connecting' | 'connected' | 'lost';
export type FoundTv = { key: string; name: string; tvId: string };

export type RemoteState = {
  status: RemoteStatus;
  tvName?: string;
  /** Last error to show in the device sheet (failed connect, bad code). */
  error?: string;
  found: FoundTv[];
  tvMode: RemoteMode;
  /** The TV's Now Playing layout (absent with an older TV). */
  tvLayout?: RemoteLayout;
  /** Song -> video timeline offset the TV reports while it shows video (undefined: unknown). */
  tvVideoOffset?: number;
  /** The rest of what the TV shows (absent with an older TV): drives the "On TV" status icons and the phone's lyrics. */
  tvInfo?: TvInfo;
};

/** What a TV snapshot says about the TV's own screen. */
export type TvInfo = Pick<TvSnapshot, 'resolvedLayout' | 'videoId' | 'videoTier' | 'videoKind' | 'videoState' | 'lyrics' | 'quality'>;
const infoOf = (m: TvSnapshot): TvInfo | undefined => {
  const i: TvInfo = {};
  if (m.resolvedLayout && isRemoteLayout(m.resolvedLayout)) i.resolvedLayout = m.resolvedLayout;
  if (m.videoId !== undefined) i.videoId = m.videoId;
  if (m.videoTier) i.videoTier = m.videoTier;
  if (m.videoKind) i.videoKind = m.videoKind;
  if (m.videoState) i.videoState = m.videoState;
  if (m.lyrics) i.lyrics = m.lyrics;
  if (m.quality) i.quality = m.quality;
  return Object.keys(i).length ? i : undefined;
};

export const useRemote = create<RemoteState>(() => ({ status: 'off', found: [], tvMode: 'audio' }));
const set = (p: Partial<RemoteState>) => useRemote.setState(p);


function deviceId(): string {
  let id = storage.getString('remote.deviceId');
  if (!id) {
    id = randomHex(8);
    storage.set('remote.deviceId', id);
  }
  return id;
}

// ---- discovery ----

let stopBrowse: (() => void) | undefined;
export function startDiscovery(): void {
  if (stopBrowse) return;
  const found = new Map<string, FoundTv>();
  stopBrowse = browseTvs((e) => {
    if (e.found) found.set(e.key, { key: e.key, name: e.name, tvId: e.tvId });
    else found.delete(e.key);
    set({ found: [...found.values()] });
  });
}
export function stopDiscovery(): void {
  stopBrowse?.();
  stopBrowse = undefined;
  set({ found: [] });
}

// ---- session ----

type Session = {
  target: string;
  tvId?: string;
  client?: RemoteClient;
  /** True once the user disconnects, or the session ended; stops reconnecting. */
  over: boolean;
  /** First successful connect has handed the queue over. */
  handedOver: boolean;
  /** Ignore TV state until it reflects the queue we handed over (avoids flashing the TV's old queue). */
  gateTrack?: string;
  gateUntil: number;
  /** Send time of the newest heartbeat applied; older ones are dropped. */
  lastTickAt?: number;
  /** The TV reports song time, so seeks go out in song seconds (an older TV gets the playing timeline's). */
  songTime: boolean;
  /** Pending correction of the clock (see phoneClock.ts) and when it last advanced. */
  corr: number;
  clockAt: number;
  /** An optimistic play / pause the TV has not confirmed yet. */
  statusHold: StatusHold;
  reconnect?: ReturnType<typeof setTimeout>;
  launchTimer?: ReturnType<typeof setTimeout>;
  /** The phone's own player state at connect time, restored when leaving. */
  local?: ReturnType<typeof playerState>;
};
let session: Session | undefined;
let monitor: ReturnType<typeof setInterval> | undefined;
let clockTimer: ReturnType<typeof setInterval> | undefined;

/** Connects to a TV: `target` is "host:port" or "svc:<key>" (a discovered TV). Hands the current queue over on connect. */
export async function connectTv(target: string, hint: { name?: string; tvId?: string } = {}): Promise<void> {
  // Picking the TV we are already on must not tear the session down and redial (the TV logged release/controlled pairs for that):
  // just play the current song there.
  if (session && !session.over && (session.target === target || (hint.tvId && session.tvId === hint.tvId))) {
    if (session.client?.status === 'ready') session.client.send({ t: 'play' });
    return;
  }
  if (session) disconnectTv();
  const s: Session = { target, tvId: hint.tvId, over: false, handedOver: false, gateUntil: 0, songTime: false, corr: 0, clockAt: Date.now(), statusHold: null };
  session = s;
  set({ status: 'connecting', tvName: hint.name ?? target.replace(/^svc:/, ''), error: undefined });
  dialSession(s);
  clearInterval(monitor);
  monitor = setInterval(watchSilence, 1000);
  clearInterval(clockTimer);
  clockTimer = setInterval(() => stepPhoneClock(s), 250);
}

function dialSession(s: Session): void {
  if (s.over) return;
  const client: RemoteClient = new RemoteClient({
    dial,
    deviceId: deviceId(),
    name: Device.deviceName ?? 'iPhone',
    onStatus: (st, info) => {
      if (s.client !== client || s.over) return;
      if (st === 'ready') {
        set({ status: 'connected', error: undefined });
        onReady(s, client);
      } else if (st === 'closed') {
        onClosed(s, info?.error);
      }
    },
    onTv: (tv) => {
      s.tvId = tv.tvId;
      set({ tvName: tv.name });
    },
    onMessage: (m) => onTvMessage(s, m),
  });
  s.client = client;
  client.connect(s.target);
}

function onReady(s: Session, client: RemoteClient): void {
  log('remote', `connected (${s.handedOver ? 'reconnect' : 'first'})`);
  if (s.handedOver) return;
  s.handedOver = true;
  const local = playerState();
  s.local = local;
  // The phone goes silent: local playback stops now and the bridge keeps it from restarting (headset, lock screen, interruptions).
  if (videoFlag.active) void exitVideo({ play: false });
  void TrackPlayer.pause().catch(() => {});
  remoteRoute.handlers = handlers;
  remoteRoute.deviceName = useRemote.getState().tvName;
  remoteRoute.release = releaseRemote;
  handOver(s, client);
}

/** Pushes the phone's current song and queue to the TV, which plays it (even if the phone was paused or the TV was playing something else). A phone with nothing selected just mirrors the TV. */
function handOver(s: Session, client: RemoteClient): void {
  const local = s.local ?? playerState();
  const cur = local.queue[local.index];
  if (!cur || !shouldHandOver(local)) return;
  // The TV cannot play files that live on this iPhone: a local current song stays here, others are left out of the TV's queue.
  if (isLocalId(cur.id)) return void showNotice("Songs from this iPhone can't play on the TV.", 5000);
  const tracks = local.queue.filter((t) => !isLocalId(t.id));
  const index = tracks.indexOf(cur);
  s.gateTrack = cur.id;
  s.gateUntil = Date.now() + 4000;
  client.send({ t: 'playQueue', tracks: tracks.map(toWire), index, position: local.position, source: local.source, sourceName: local.sourceName });
}

function onTvMessage(s: Session, m: ServerMsg): void {
  if (s.over) return;
  if (useRemote.getState().status === 'lost') set({ status: 'connected' });
  if (m.t === 'launching') {
    showNotice(`Starting Sangeet on ${useRemote.getState().tvName}…`, 20_000);
    clearTimeout(s.launchTimer);
    s.launchTimer = setTimeout(() => showNotice("The TV didn't start Sangeet. Open it once with the TV remote, then try again.", 8000), 20_000);
    return;
  }
  if (m.t === 'state' && m.track && s.launchTimer) {
    clearTimeout(s.launchTimer);
    s.launchTimer = undefined;
    clearNotice();
  }
  if (m.t === 'state') {
    if (s.gateTrack && Date.now() < s.gateUntil && m.track?.videoId !== s.gateTrack) return;
    s.gateTrack = undefined;
    s.songTime = reportsSongTime(m);
    const prev = playerState();
    const trackChanged = prev.queue[prev.index]?.id !== m.track?.videoId;
    const patch = applyTvState(prev, m);
    const pos = songPositionOf(m);
    // After a seek the TV may still report the old spot for a moment: keep the target the thumb jumped to.
    if (!trackChanged && seekHoldDrops(pos)) delete patch.position;
    else reportPosition(s, pos, m.status, trackChanged);
    const held = applyStatusHold(s.statusHold, m.status, Date.now());
    s.statusHold = held.hold;
    patch.status = held.status;
    setPlayerState(patch);
    if (isRemoteLayout(m.layout)) rememberVideoLyrics(m.layout);
    set({ tvMode: m.mode, tvLayout: isRemoteLayout(m.layout) ? m.layout : undefined, tvVideoOffset: typeof m.videoOffset === 'number' ? m.videoOffset : undefined, tvInfo: infoOf(m) });
  } else if (m.t === 'tick') {
    if (s.gateTrack && Date.now() < s.gateUntil) return;
    if (m.at !== undefined) {
      if (s.lastTickAt !== undefined && m.at < s.lastTickAt) return; // out of order
      s.lastTickAt = m.at;
    }
    const pos = songPositionOf(m);
    const held = applyStatusHold(s.statusHold, m.status, Date.now());
    s.statusHold = held.hold;
    if (seekHoldDrops(pos)) return;
    const patch = applyTick(playerState(), { ...m, status: held.status });
    delete patch.position;
    reportPosition(s, pos, held.status, false);
    if (Object.keys(patch).length) setPlayerState(patch);
  }
}

/** A TV position report into the phone's clock: usually folded in gently, a jump on a track change, a pause or a seek. */
function reportPosition(s: Session, pos: number, status: PlayStatus, jump: boolean): void {
  const r = reportClock(playerState().position, pos, status === 'playing', jump);
  s.corr = r.corr;
  s.clockAt = Date.now();
  if (r.pos !== playerState().position) setPlayerState({ position: r.pos });
}

/** Between TV reports the phone advances the position itself (and applies any pending correction). */
function stepPhoneClock(s: Session): void {
  if (s.over) return;
  const now = Date.now();
  const st = playerState();
  const r = stepClock(st.position, s.corr, now - s.clockAt, st.status === 'playing' && !seekHoldActive(), st.duration || st.queue[st.index]?.durationSec || 0);
  s.corr = r.corr;
  s.clockAt = now;
  if (Math.abs(r.pos - st.position) > 0.01) setPlayerState({ position: r.pos });
}

function onClosed(s: Session, error?: string): void {
  if (s.over) return;
  if (!s.handedOver) {
    // Never got in: report and end (wrong address, TV off).
    set({ status: 'off', error: error ?? 'Could not connect' });
    showNotice(`Could not connect to the TV${error ? `: ${error}` : ''}`);
    end(s);
    return;
  }
  logWarn('remote', `connection lost: ${error ?? 'closed'}`);
  set({ status: 'lost' });
  clearTimeout(s.reconnect);
  s.reconnect = setTimeout(() => dialSession(s), 2000);
}

/** Silence > 5 s shows the lost banner; a half-open socket (> 12 s) is torn down so the retry loop takes over. */
function watchSilence(): void {
  const s = session;
  const c = s?.client;
  if (!s || !c || c.status !== 'ready') return;
  const quiet = Date.now() - c.lastSeen;
  if (quiet > SILENCE_MS && useRemote.getState().status === 'connected') set({ status: 'lost' });
  if (quiet > 12_000) {
    c.close();
    s.client = undefined;
    clearTimeout(s.reconnect);
    s.reconnect = setTimeout(() => dialSession(s), 500);
  }
}

function end(s: Session): void {
  s.over = true;
  clearTimeout(s.reconnect);
  clearTimeout(s.launchTimer);
  clearInterval(monitor);
  clearInterval(clockTimer);
  s.client?.close();
  if (session === s) session = undefined;
  remoteRoute.handlers = undefined;
  remoteRoute.deviceName = undefined;
  remoteRoute.release = undefined;
  set({ tvMode: 'audio', tvLayout: undefined, tvVideoOffset: undefined, tvInfo: undefined });
}

/** CarPlay (or anything local) takes over: drop the TV without bringing the queue back. */
function releaseRemote(): void {
  const s = session;
  if (!s) return;
  end(s);
  set({ status: 'off' });
  // CarPlay is about to play locally and replaces the queue itself.
}

/** The TV the phone is controlling (for Undo after leaving it), undefined when there is none. */
export const currentTvLink = (): { target: string; name?: string; tvId?: string } | undefined =>
  session && !session.over ? { target: session.target, name: useRemote.getState().tvName, tvId: session.tvId } : undefined;

/** Leaves the TV without touching it (it keeps playing its queue); the phone returns to its own last local state, stopped. */
export function disconnectTv(): void {
  const s = session;
  if (!s) return set({ status: 'off', error: undefined });
  end(s);
  set({ status: 'off', error: undefined });
  if (s.local) setPlayerState(localAfterLeave(s.local));
  else setPlayerState({ queue: [], index: 0, status: 'idle', position: 0, duration: 0 });
}

// ---- remote-mode player actions ----

const send = (m: ClientMsg) => session?.client?.send(m);
const isOn = () => ['playing', 'buffering'].includes(playerState().status);

/** Optimistic, then the TV's word: a stale report within a moment must not undo what the user just did. */
const holdFor = (on: boolean) => {
  if (session) session.statusHold = startStatusHold(on, Date.now());
  setPlayerState({ status: on ? 'playing' : 'paused' });
};

/** Skips to `target` at once on screen (the TV is the authority: its state replaces this as soon as it arrives, and the gate holds off stale reports). */
function optimisticSkip(index: number): void {
  const s = session;
  const st = playerState();
  const target = st.queue[index];
  if (!s || !target) return;
  s.gateTrack = target.id;
  s.gateUntil = Date.now() + HOLD_MAX_REMOTE_MS;
  s.corr = 0;
  setPlayerState({ index, position: 0, duration: target.durationSec ?? 0, status: 'playing' });
  startSeekHold(0, Date.now(), HOLD_MAX_REMOTE_MS);
}

const handlers: RemoteHandlers = {
  playTracks: (tracks, startIndex, opts) => {
    const start = tracks[startIndex];
    if (!start) return;
    // Files on this iPhone cannot play on the TV: only the YouTube songs of a mixed list are sent.
    if (isLocalId(start.id)) return void showNotice("Songs from this iPhone can't play on the TV");
    const seen = new Set<string>();
    const unique = tracks.filter((t) => !isLocalId(t.id) && (seen.has(t.id) ? false : (seen.add(t.id), true)));
    send({ t: 'playQueue', tracks: unique.map(toWire), index: unique.findIndex((t) => t.id === start.id), shuffle: opts.shuffle, source: opts.source, sourceName: opts.sourceName });
    setPlayerState({ queue: unique, index: unique.findIndex((t) => t.id === start.id), position: 0, duration: start.durationSec ?? 0, status: 'buffering' }); // optimistic; the TV state follows
  },
  playNext: (t) => (isLocalId(t.id) ? showNotice("Songs from this iPhone can't play on the TV") : send({ t: 'playNext', track: toWire(t) })),
  addToQueue: (t) => (isLocalId(t.id) ? showNotice("Songs from this iPhone can't play on the TV") : send({ t: 'addToQueue', track: toWire(t) })),
  togglePlay: () => {
    const on = isOn();
    send({ t: on ? 'pause' : 'play' });
    holdFor(!on);
  },
  skipNext: () => {
    send({ t: 'next' });
    const st = playerState();
    if (st.repeat === 'one') return void handlers.seekTo(0);
    const i = st.index + 1 < st.queue.length ? st.index + 1 : st.repeat === 'all' && st.queue.length > 1 ? 0 : -1;
    if (i >= 0) optimisticSkip(i);
  },
  skipPrevious: () => {
    send({ t: 'prev' });
    const st = playerState();
    if (st.position > 3) return void handlers.seekTo(0);
    if (st.index > 0) optimisticSkip(st.index - 1);
  },
  seekTo: (sec) => {
    // Song seconds when the TV reports song time (it maps them onto the video's timeline itself).
    send({ t: 'seek', sec, ...(session?.songTime ? { song: true } : {}) });
    startSeekHold(sec, Date.now(), HOLD_MAX_REMOTE_MS);
    if (session) session.corr = 0;
    setPlayerState({ position: sec });
  },
  skipToIndex: (i) => {
    send({ t: 'playIndex', index: i });
    optimisticSkip(i);
  },
  setShuffle: (on) => send({ t: 'setShuffle', on }),
  setRepeat: (mode) => send({ t: 'setRepeat', mode }),
};

/** Remote mode: the quality picker changes the TV's quality. */
export const setTvQuality = (kind: 'audio' | 'video', value: string) => send({ t: 'setQuality', kind, value });

export const setTvMode = (mode: RemoteMode) => send({ t: 'setMode', mode });

/** The phone's Audio / Video switch while controlling a TV: changes the TV's layout (keeping its lyrics panel). */
export function setTvSide(side: RemoteMode): void {
  const { tvLayout } = useRemote.getState();
  if (!tvLayout) return setTvMode(side); // older TV: only knows setMode
  const layout = layoutForSwitch(tvLayout, side, lastVideoLyrics());
  set({ tvLayout: layout, tvMode: side }); // optimistic; the TV's state follows
  send({ t: 'setLayout', layout });
}

/** The layout chooser on the phone: the TV changes its layout; the phone shows the choice at once. */
export function setTvLayoutChoice(layout: RemoteLayout): void {
  set({ tvLayout: layout, tvMode: usesVideo(layout) ? 'video' : 'audio', tvInfo: { ...useRemote.getState().tvInfo, resolvedLayout: layout } });
  send({ t: 'setLayout', layout });
}

/** "Choose video" while controlling a TV: the TV picks it and shows it (its choice is what comes back). */
export const chooseTvVideo = (songId: string, videoId: string | null) => send({ t: 'chooseVideo', videoId, songId });
/** "Watch video" while controlling a TV. */
export const watchTvVideo = () => send({ t: 'watchVideo' });
/** The lyrics sync arrows while controlling a TV: the TV keeps the offset; the phone shows it at once. */
export function setTvLyricsOffset(songId: string, ms: number): void {
  const info = useRemote.getState().tvInfo;
  if (info?.lyrics) set({ tvInfo: { ...info, lyrics: { ...info.lyrics, offsetMs: ms } } });
  send({ t: 'setLyricsOffset', ms, songId });
}
