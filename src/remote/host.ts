import * as Device from 'expo-device';
import { AppState, Platform } from 'react-native';

import { listen, randomHex } from '../../modules/sangeet-remote';
import { toggleLike } from '../library/store';
import { addToQueue, playNext, playTracks, seekTo, setRepeat, setShuffle, skipNext, skipPrevious, skipToIndex, togglePlay } from '../player';
import { playerState, usePlayerStore } from '../player/store';
import { log, logWarn } from '../util/log';
import { getJson, setJson, storage } from '../util/storage';
import { noteRemoteWake } from '../tv/activity';
import { layoutForMode, layoutForSwitch, usesVideo } from '../tv/layout';
import { tvNav } from '../tv/nav';
import { lastVideoLyrics, setTvLayout, tvLayout, useTvPlayer } from '../tv/playerPrefs';
import { useMirrorInfo } from '../tv/MirrorPublisher';
import { useVideoStore, watchVideo } from '../video/controller';
import { canChooseVideo, chooseVideo } from '../video/counterpart';
import { setLyricsOffset } from '../lyrics/settings';
import { SYNC_MAX_MS } from '../lyrics/syncAdjust';
import { offsetSec, useOffsets } from '../video/offsets';
import { applyQuality } from '../video/quality';
import { clearStarting, markStarting, useHostUi } from './hostUi';
import { heartbeatPosition } from '../lyrics/clockMath';
import { buildSnapshot, toPlayingTime } from './mirror';
import { DEFAULT_PORT, fromWire, isRemoteLayout, type ClientMsg } from './protocol';
import { RemoteServer, type CommandHandler } from './server';

const isPlaying = () => ['playing', 'buffering'].includes(playerState().status);
const mode = () => (useVideoStore.getState().mode === 'video' ? 'video' : 'audio');
/** The song -> video timeline offset of what the TV is showing in video mode (undefined in song mode or while unknown). */
const videoOffset = () => {
  const v = useVideoStore.getState();
  const s = playerState();
  return v.mode === 'video' && s.queue[s.index] ? offsetSec(s.queue[s.index].id, v.videoId) : undefined;
};

/** Runs an authenticated phone command against the TV's own player. */
/** Name of the phone that last connected, for the "Playing from ..." toast. */
let lastPhone = 'your phone';

/**
 * Playback was just started from the phone: always show the player (in the saved layout), even when someone is browsing
 * on the TV, and say where the sound comes from with a short toast.
 */
function surfacePlayback(): void {
  const nav = tvNav();
  if (nav.stack[nav.stack.length - 1].name !== 'now') nav.root({ name: 'now' });
  // Nothing loaded yet (e.g. the app was just launched by this command): Now Playing shows "Starting playback" instead of "Nothing is playing".
  if (!playerState().queue[playerState().index]) markStarting(lastPhone);
  useHostUi.setState({ toast: { text: `Playing from ${lastPhone}`, id: Date.now() } });
}

/** A skip from the phone means "play that song": start playback when the TV was paused. */
async function skipAndPlay(skip: () => Promise<unknown>): Promise<void> {
  const was = isPlaying();
  await skip();
  if (!was && !isPlaying()) await togglePlay();
  surfacePlayback();
}

/** Commands that make the TV play (or show video): they bring the app to the front when it is not there. */
const WAKES = new Set<string>(['playQueue', 'addToQueue', 'playNext', 'playIndex', 'play', 'next', 'prev', 'setMode', 'setLayout', 'watchVideo', 'chooseVideo']);

/** Shows the video layout (the user's last Video + Lyrics variant when coming from a lyrics layout) and brings Now Playing up. */
function showVideoLayout(): void {
  setTvLayout(layoutForSwitch(tvLayout(), 'video', lastVideoLyrics()));
  if (tvNav().stack[tvNav().stack.length - 1].name !== 'now' && playerState().queue.length) tvNav().push({ name: 'now' });
}

export const handleCommand: CommandHandler = (m: Exclude<ClientMsg, { t: 'hello' | 'bye' }>, from?: { deviceId: string; name: string }) => {
  const fg = AppState.currentState === 'active';
  log('remote', `cmd=${m.t} from=${from?.name ?? '?'} fg=${fg} status=${playerState().status} queue=${playerState().queue.length}${m.t === 'playQueue' ? ` n=${m.tracks.length} first=${m.tracks[m.index]?.videoId}` : ''}`);
  if (!fg && WAKES.has(m.t)) noteRemoteWake(); // the native hub launches the activity; its AppState changes must not pause playback
  switch (m.t) {
    case 'playQueue': {
      const p = playTracks(m.tracks.map(fromWire), Math.max(0, Math.min(m.index, m.tracks.length - 1)), { source: m.source ?? 'remote', sourceName: m.sourceName, shuffle: m.shuffle, startAt: m.position });
      surfacePlayback();
      return void p;
    }
    case 'addToQueue': {
      const idle = !isPlaying();
      const p = addToQueue(fromWire(m.track));
      if (idle) surfacePlayback();
      return void p;
    }
    case 'playNext':
      return void playNext(fromWire(m.track));
    case 'playIndex':
      return void skipAndPlay(() => skipToIndex(m.index));
    case 'play':
      // An empty queue right after launch is usually the saved queue still restoring: show the loading view meanwhile.
      if (playerState().queue.length || !fg) surfacePlayback();
      return void (!isPlaying() && togglePlay());
    case 'pause':
      return void (isPlaying() && togglePlay());
    case 'next':
      return void skipAndPlay(skipNext);
    case 'prev':
      return void skipAndPlay(skipPrevious);
    case 'seek': {
      const sec = Math.max(0, Number(m.sec) || 0);
      // `song: true`: song seconds, mapped onto the video's timeline here while a video plays (the TV knows the offset).
      return void seekTo(m.song ? toPlayingTime(sec, useVideoStore.getState().mode === 'video', videoOffset(), playerState().duration) : sec);
    }
    case 'chooseVideo': {
      const t = playerState().queue[playerState().index];
      if (!t || (m.songId && m.songId !== t.id) || !canChooseVideo(t)) return;
      chooseVideo(t.id, m.videoId);
      // Same as the TV's own picker: a picked video is shown at once.
      if (m.videoId && m.videoId !== 'none') {
        showVideoLayout();
        void watchVideo(t);
      }
      return;
    }
    case 'watchVideo': {
      const t = playerState().queue[playerState().index];
      if (!t) return;
      showVideoLayout();
      void watchVideo(t);
      return;
    }
    case 'setLyricsOffset': {
      const t = playerState().queue[playerState().index];
      if (!t || (m.songId && m.songId !== t.id)) return;
      return setLyricsOffset(t.id, Math.round(Math.max(-SYNC_MAX_MS, Math.min(SYNC_MAX_MS, Number(m.ms) || 0))));
    }
    case 'setMode': // older phones: audio/video map onto the TV layout (the Now Playing screen applies it)
      setTvLayout(layoutForMode(m.mode));
      if (m.mode === 'video' && tvNav().stack[tvNav().stack.length - 1].name !== 'now' && playerState().queue.length) tvNav().push({ name: 'now' });
      return;
    case 'setLayout':
      if (!isRemoteLayout(m.layout)) return;
      setTvLayout(m.layout);
      if (usesVideo(m.layout) && tvNav().stack[tvNav().stack.length - 1].name !== 'now' && playerState().queue.length) tvNav().push({ name: 'now' });
      return;
    case 'setShuffle':
      return void setShuffle(!!m.on);
    case 'setRepeat':
      return void setRepeat(m.mode);
    case 'setQuality':
      return void applyQuality(m.kind === 'video' ? 'video' : 'audio', String(m.value));
    case 'like': {
      const t = playerState().queue[playerState().index];
      if (t) toggleLike(t);
    }
  }
};

function tvIdentity(): { id: string; name: string } {
  let id = storage.getString('remote.tvId');
  if (!id) {
    id = randomHex(8);
    storage.set('remote.tvId', id);
  }
  const saved = getJson<string>('remote.tvName');
  return { id, name: saved ?? Device.deviceName ?? 'Google TV' };
}

export const setTvName = (name: string) => setJson('remote.tvName', name.trim());

let server: RemoteServer | undefined;

/** TV: listens for phones (TCP + mDNS), executes their commands, and pushes player state back. Idempotent. */
export function startRemoteHost(): void {
  if (server || Platform.OS !== 'android') return;
  const { id, name } = tvIdentity();
  // The store reports position ~4x/s: remember when it last moved so heartbeats can extrapolate to the send moment.
  let posAt = Date.now();
  let lastPos = playerState().position;
  usePlayerStore.subscribe((s) => {
    if (s.queue[s.index]) clearStarting();
    if (s.position !== lastPos) {
      lastPos = s.position;
      posAt = Date.now();
    }
  });
  let toastId = 0;
  let lastToastPhone = '';
  let lastToastAt = 0;
  server = new RemoteServer({
    tvId: id,
    name,
    handle: handleCommand,
    snapshot: () => {
      const s = playerState();
      const snap = buildSnapshot(s, mode(), tvLayout(), videoOffset(), useMirrorInfo.getState().info);
      const position = heartbeatPosition(snap.position, s.status === 'playing', Date.now() - posAt);
      // Song time moves with the same extrapolation.
      return { ...snap, position, ...(snap.songPosition !== undefined ? { songPosition: snap.songPosition + (position - snap.position) } : {}) };
    },
    onController: (phone, on) => {
      log('remote', `${on ? 'controlled by' : 'released by'} a phone`);
      useHostUi.setState({ phones: Math.max(0, useHostUi.getState().phones + (on ? 1 : -1)) });
      if (on) lastPhone = phone;
      // A phone redialling within seconds (reconnect) is not news: no second toast.
      if (on && !(phone === lastToastPhone && Date.now() - lastToastAt < 15_000)) useHostUi.setState({ toast: { text: `Controlled by ${phone}`, id: ++toastId } });
      if (on) {
        lastToastPhone = phone;
        lastToastAt = Date.now();
      }
    },
  });
  const srv = server;
  try {
    const port = listen(DEFAULT_PORT, name, id, (_conn, link) => {
      const h = srv.accept(link);
      return { onOpen() {}, onData: h.onData, onClose: () => h.onClose() };
    });
    log('remote', `host listening on ${port} as "${name}"`);
  } catch (e) {
    logWarn('remote', 'host failed to start', e instanceof Error ? e.message : e);
    server = undefined;
    return;
  }
  // Push on change; 1 Hz heartbeat carries position. Structural changes only so a 4 Hz progress feed does not spam.
  const key = (s = playerState()) => `${s.queue.length}:${s.queue[s.index]?.id}:${s.index}:${s.status}:${s.shuffle}:${s.repeat}:${mode()}:${tvLayout()}:${videoOffset()}:${JSON.stringify(useMirrorInfo.getState().info)}`;
  let last = key();
  // Changes arrive in bursts (a song change moves the queue, the video and the lyrics in a few frames): one snapshot ~100 ms after the last.
  let pending: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    if (key() === last) return;
    clearTimeout(pending);
    pending = setTimeout(() => {
      const k = key();
      if (k === last) return;
      last = k;
      srv.broadcastState();
    }, 100);
  };
  useMirrorInfo.subscribe(check);
  usePlayerStore.subscribe(check);
  useVideoStore.subscribe(check);
  useOffsets.subscribe(check);
  useTvPlayer.subscribe(check);
  setInterval(() => srv.broadcastTick(), 1000);
}
