import { LogBox } from 'react-native';

import { log } from '../util/log';
import { TrackPlayer } from 'react-native-nitro-player';

import { clearUpcoming, moveInQueue, seekTo, skipToIndex, setRepeat, setShuffle, skipNext, skipPrevious, togglePlay } from '../player';
import { intent } from '../player/intent';
import { playerState } from '../player/store';
import { lyricsSources, setLyricsOffset, toggleSource, useLyricsOffsets } from '../lyrics/settings';
import { getLyrics } from '../lyrics';
import { activeLineIndex } from '../lyrics/lrc';
import { setJson } from '../util/storage';
import { enterVideo, exitVideo } from '../video/controller';
import { downloadTracks, downloadedGroups, removeAllDownloads, useDownloads } from '../downloads/manager';
import { setForcedOffline } from '../downloads/net';
import { createLocalPlaylist, useLibraryStore } from '../library/store';
import { getAlbum } from '../youtube/api';
import { extractorBridge } from '../youtube/extractor/bridge';
import { resolver } from '../player/proxy';
import { runHealthCheck } from '../youtube/resolver/healthCheck';
import { saveServerConfig, setForceServerOnly } from '../youtube/resolver/serverConfig';

/**
 * Dev-only simulator driver, reached through the hidden `dev` route: `sangeet://dev?cmd=<name>&a=<arg>&b=<arg>`.
 * Also on in screenshot builds (SANGEET_SCREENSHOTS=1). Commands: next, prev, toggle, seek(a=sec), shuffle(a=0|1), repeat(a=off|all|one), move(a,b), clear, dump.
 */
export function runDevCommand(cmd: string, a?: string, b?: string): void {
  log('dev', `cmd=${cmd} a=${a ?? ''} b=${b ?? ''}`);
  switch (cmd) {
    case 'lyricsprobe': { // reports {position, activeIndex, line} every second for 30 s (a = seconds, default 30)
      const t = playerState().queue[playerState().index];
      if (!t) return;
      return void getLyrics(t).then((l) => {
        const lines = l?.synced ?? [];
        const off = useLyricsOffsets.getState().offsets[t.id] ?? 0;
        let n = 0;
        const iv = setInterval(() => {
          const s = playerState();
          const i = activeLineIndex(lines, s.position + off / 1000);
          log('lyricsprobe', JSON.stringify({ pos: Number(s.position.toFixed(2)), status: s.status, activeIndex: i, lineTime: lines[i]?.time ?? null, text: lines[i]?.text ?? null }));
          if (++n >= Number(a ?? 30)) clearInterval(iv);
        }, 1000);
      });
    }
    case 'offsetscan': // a=queries separated by ~ ("title artist"): song, its video, every offset method with timings (research)
      return void import('../video/offsetProbe').then((m) => m.scan((a ?? '').split('~'), b === 'all'));
    case 'serverset': // a=url, b=dev token (local test server only)
      return void saveServerConfig(a ?? '', b ?? '').then(() => log('dev', `server set ${a}`));
    case 'serveronly': // a=0|1: skip the on-device resolver
      return void setForceServerOnly(a === '1');
    case 'health':
      return void runHealthCheck(resolver);
    case 'offline': // a=0|1: app-level forced-offline flag (the host network is never touched)
      return void setForcedOffline(a === '1');
    case 'dlalbum': // a=album browse id
      return void getAlbum(a!).then((p) => log('dev', `download album ${p.album.title}: queued ${downloadTracks(p.tracks, { kind: 'album', id: a!, name: p.album.title })}`)).catch((e) => log('dev', `dlalbum failed ${e}`));
    case 'dltrack': // a=videoId (needs the track in the queue/library metadata)
      return void downloadTracks(playerState().queue.filter((t) => t.id === a));
    case 'dlclear':
      return void removeAllDownloads();
    case 'dldump': {
      const rows = Object.values(useDownloads.getState().byId);
      return log('dev', `downloads ${rows.length}: ${rows.map((r) => `${r.trackId}=${r.state}:${r.bytes}/${r.totalBytes}:${r.error ?? ''}`).join(' ')} groups=${downloadedGroups().map((g) => `${g.name}(${g.trackIds.length})`).join(',')}`);
    }
    case 'newpl': // a=name; adds the current queue's first 4 tracks
      return void log('dev', `created ${createLocalPlaylist(a ?? 'Dev mix', playerState().queue.slice(0, 4))}`);
    case 'pldump':
      return log('dev', `playlists ${JSON.stringify(useLibraryStore.getState().playlists.map((p) => ({ n: p.name, c: p.count, art: p.art.length })))}`);
    case 'remotepause': // simulates a CarPlay/steering-wheel pause: the intent event, then the native pause
      intent.cancel('remote');
      return void TrackPlayer.pause();
    case 'play': // a=comma list of videoIds, b='video' marks them as videos
      return void import('../player').then((m) => m.playTracks((a ?? '').split(',').map((id) => ({ kind: 'track' as const, id, title: id, artists: [{ name: 'dev' }], artwork: [], ...(b === 'video' ? { isVideo: true } : {}) })), 0, { source: 'dev' }));
    case 'playq': // a=search query, b=index of the result (default 0): plays that song with full metadata
      return void import('../youtube/api').then(async (api) => {
        const r = await api.search(a ?? '', 'song');
        const tracks = r.items.filter((i) => i.kind === 'track');
        const t = tracks[Number(b || 0)];
        log('dev', `playq: ${r.items.length} items, ${tracks.length} tracks, first=${r.items[0]?.kind}`);
        if (t && t.kind === 'track') void (await import('../player')).playTracks([t], 0, { source: 'dev' });
      });
    case 'playid': // a=videoId: plays it with metadata taken from its up-next panel (b='more' keeps the radio)
      return void import('../youtube/api').then(async (api) => {
        const list = await api.getUpNext(a ?? '');
        const t = list.find((x) => x.id === a) ?? list[0];
        log('dev', `playid: ${list.length} up-next, using ${t?.id} ${t?.title}`);
        if (t) void (await import('../player')).playTracks([t], 0, { source: 'dev' });
      });
    case 'offset': // a=ms: lyrics sync offset of the current track (the sync control shows once it is not 0)
      return void setLyricsOffset(playerState().queue[playerState().index]?.id ?? '', Number(a) || 0);
    case 'quiet': // hide the RN warning toast so it does not cover screenshots
      return LogBox.ignoreAllLogs(true);
    case 'toplain': // a=videoId: caches that track's lyrics as plain text (to see the unsynced layout), needs the track in the queue
      return void (async () => {
        const t = playerState().queue.find((x) => x.id === a) ?? playerState().queue[playerState().index];
        const l = t ? await getLyrics(t) : null;
        if (t && l) setJson(`lyrics.v1.${t.id}`, { at: Date.now(), data: (await import('../lyrics/fit')).toPlain(l) });
        log('dev', `toplain ${t?.id}: ${l ? 'done' : 'no lyrics'}`);
      })();
    case 'tvnow': // opens Now Playing on the TV
      return void import('../tv/nav').then((m) => m.tvNav().push({ name: 'now' }));
    case 'tvlayout': // a=video|videoLyrics|musicLyrics|music|lyrics (TV Now Playing layout)
      return void import('../tv/playerPrefs').then((m) => m.setTvLayout(a as never));
    case 'tvconnect': // a=host:port (for example 127.0.0.1:8765 through `adb forward`)
      return void import('../remote/phone').then((m) => m.connectTv(a ?? '127.0.0.1:8765', { name: 'Living room TV' }));
    case 'tvside': // a=audio|video: the phone's Audio / Video switch while controlling a TV
      return void import('../remote/phone').then((m) => m.setTvSide(a === 'video' ? 'video' : 'audio'));
    case 'tvfound': // a,b=names: list fake discovered TVs in the Play-on sheet (the simulator cannot see mDNS)
      return void import('../remote/phone').then((m) => m.useRemote.setState({ found: [a, b].filter((n): n is string => !!n).map((n, i) => ({ key: `dev${i}`, name: n, tvId: `dev${i}` })) }));
    case 'libdemo': // a=album search query, b='dl' also downloads it: saves the top album result, likes its first 3 songs (screenshots)
      return void import('../youtube/api').then(async (api) => {
        const album = (await api.search(a ?? '', 'album')).items.find((i) => i.kind === 'album');
        if (!album) return log('dev', `libdemo: no album for ${a}`);
        const p = await getAlbum(album.id);
        const lib = await import('../library/store');
        lib.toggleSaved(p.album);
        p.tracks.slice(0, 3).forEach((t) => lib.toggleLike(t));
        if (b === 'dl') downloadTracks(p.tracks, { kind: 'album', id: album.id, name: p.album.title });
        log('dev', `libdemo: saved ${p.album.title}${b === 'dl' ? ' and queued the download' : ''}`);
      });
    case 'savealbum': // a=album browse id: saves it and likes its first 3 songs
      return void getAlbum(a!).then(async (p) => {
        const lib = await import('../library/store');
        lib.toggleSaved(p.album);
        p.tracks.slice(0, 3).forEach((t) => lib.toggleLike(t));
      });
    case 'tvdisconnect':
      return void import('../remote/phone').then((m) => m.disconnectTv());
    case 'proxyfail': // a=0|1: the proxy fails every upstream request while the app still thinks it is online (real native item failures)
      return void import('../../modules/stream-proxy').then((m) => (m.default as { setSimulateOffline?: (on: boolean) => void }).setSimulateOffline?.(a === '1'));
    case 'fail': // simulates a mid-song source error (what nitro-player reports after its own retries)
      return void import('../player/queue').then((m) => m.onPlaybackFailed());
    case 'autocache': // a = budget in MB (0 = off)
      return void import('../downloads/settings').then((m) => m.setDownloadSettings({ autoCacheMb: Number(a) }));
    case 'cacheclear':
      return void import('../downloads/autoCache').then((m) => m.clearAutoCache());
    case 'probe':
      return void extractorBridge.request<unknown[]>('probeFormats', { videoId: a }, 90_000).then((r) => (r as any[]).forEach((c) => log('probe', JSON.stringify(c)))).catch((e) => log('probe', `failed ${e}`));
    case 'video': {
      const t = playerState().queue[playerState().index];
      return void (t && enterVideo(t));
    }
    case 'sources': { // a = comma list of enabled provider ids ('' = none); drops the current track's lyrics cache
      const on = (a ?? '').split(',');
      (['lrclib', 'lrcred', 'netease', 'ytmusic'] as const).forEach((id) => {
        const cur = lyricsSources().find((x) => x.id === id)!;
        if (cur.enabled !== on.includes(id)) toggleSource(id);
      });
      const t = playerState().queue[playerState().index];
      if (t) setJson(`lyrics.v1.${t.id}`, { at: 0, data: null });
      return;
    }
    case 'song': return void exitVideo();
    case 'next': return void skipNext();
    case 'prev': return void skipPrevious();
    case 'toggle': return void togglePlay();
    case 'seek': return void seekTo(Number(a));
    case 'shuffle': return void setShuffle(a === '1');
    case 'repeat': return void setRepeat(a as 'off' | 'all' | 'one');
    case 'move': return void moveInQueue(Number(a), Number(b));
    case 'clear': return void clearUpcoming();
    case 'watch': {
      let n = 0;
      const t = setInterval(() => {
        void TrackPlayer.getState().then((x) => log('dev', `watch state=${x.currentState} pos=${x.currentPosition.toFixed(1)} idx=${x.currentIndex}`));
        if (++n >= 12) clearInterval(t);
      }, 2000);
      return;
    }
    case 'goto': return void skipToIndex(Number(a));
    case 'native':
      return void TrackPlayer.getState().then((n) => log('dev', `native state=${n.currentState} pos=${n.currentPosition.toFixed(1)} dur=${n.totalDuration.toFixed(1)} idx=${n.currentIndex} track=${n.currentTrack?.id}`));
    case 'dump': {
      const s = playerState();
      return log('dev', `queue(${s.queue.length}) index=${s.index} status=${s.status} pos=${s.position.toFixed(1)} ids=${s.queue.slice(0, 8).map((t) => t.id).join(',')} titles=${s.queue.slice(0, 10).map((t) => t.title).join(' | ')}`);
    }
  }
}
