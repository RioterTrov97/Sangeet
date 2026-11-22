# Sangeet: developer reference

A music player built from one Expo / React Native codebase for two targets: an iPhone app (CarPlay, Siri, phone-as-TV-remote) and an Android TV app (D-pad UI, sideloaded). Streams are resolved on the device; an optional self-hosted server is the fallback.

Stack: Expo SDK 58 (Continuous Native Generation), React Native 0.88, TypeScript, `react-native-nitro-player` (AVPlayer on iOS, Media3 ExoPlayer on Android), youtubei.js in a hidden WebView extractor (PoToken, n-decipher), TanStack Query, SQLite (`src/db`), expo-video.

Working rules (no commits by agents, no personal data in tracked files, what to ask first) are in [AGENTS.md](../AGENTS.md).

## Architecture map

Top level: `app/` (expo-router phone screens), `src/` (all app code), `modules/` (local Expo modules), `plugins/` (`withAndroidTV.js`), `scripts/`, `server/` (optional backup stream server), `patches/` (patch-package), `assets/`.

| `src/` folder | Purpose |
| --- | --- |
| `auth` | Google sign-in cookies (keychain only) and the signed-in store |
| `boot.ts` | Headless start-up shared by the phone UI, CarPlay and the TV |
| `carplay` | CarPlay templates (Home, Library, Recents, Downloads), built from cache so a cold launch works without the phone UI |
| `db` | SQLite client, schema, migrations, repository |
| `dev` | Dev deep-link driver (`sangeet://dev?...`) and perf driver (`sangeet://perf?on=1`); the dev driver is off in release builds except screenshot builds (`SANGEET_SCREENSHOTS=1`) |
| `downloads` | Background downloads, whole-song auto cache, LRU eviction, offline detection |
| `home` | Home shelves, layout, personalisation |
| `import` | Spotify playlist import and matching to YouTube tracks |
| `library` | Likes, playlists, follows, pins, YouTube library sync |
| `local` | Songs from this iPhone (`Documents/Music`): scan, tags, `local-<hash>` ids |
| `lyrics` | Lyrics providers, parsing, timing clock, prefetch |
| `player` | Queue, store, playback intent, recovery, history, bridge to nitro-player |
| `remote` | Phone to TV remote protocol, host and client |
| `search` | Recent searches, suggestion model, mood tiles |
| `siri` | Siri intent handling (guarded by Info.plist flag `SangeetSiriEntitled`) |
| `tv` | The whole TV app |
| `ui` | Phone screens and shared components |
| `util` | Small helpers |
| `video` | Video counterpart matching, fallback chain, picker, Song/Video controller |
| `youtube` | API, mappers, resolver, extractor, formats, caches |

Key modules:
- **Playback**: `src/player/queue.ts` and `store.ts` wrap nitro-player. `intent.ts` keeps a playback intent open and retries `play()` because nitro-player pauses itself after load/skip. Non-current queue moves are remove plus add, because `reorderTrackInPlaylist` resets the current track. The bridge treats a native item change nobody asked for as a failed advance (`onNativeFailedAdvance`): the song stays, pauses and goes through retry, never skipping on its own. `modules/audio-events` adds remote-command targets and interruption events; `bridge.ts` deep-imports nitro's `callbackManager` so CarPlay-only launches work without React. Offline, an unsaved song stays current with a loader and starts when the network returns; the queue is topped up with related songs online and with saved songs offline.
- **Streams**: `src/youtube/extractor/page.ts` runs in the WebView and is bundled by `npm run build:extractor` (also on `postinstall`) into the checked-in `extractorHtml.generated.ts`; rerun after editing it. `src/youtube/resolver/` resolves stream URLs on device and can fall back to the backup server. `modules/stream-proxy` is a localhost range proxy (Swift, Kotlin) that gets past the ~1 MB throttle, retries once on 403/410 with a fresh URL and copes with edges that refuse tail ranges. `ensureProxyAlive` rebinds the socket if iOS took it while suspended.
- **Video**: `src/video/match.ts` scores candidates (tier A music video, B lyric video / official audio, C anything). `counterpart.ts` runs the chain: override or cache, `/next` counterpart (signed in), YouTube Music video search, web search, web search plus "official video"; later layers run only while there is no tier A. `controller.ts` switches Song/Video make-before-break with offset alignment (`offsets.ts`, `audioEnvelope.ts`). Full-screen video is the landscape `/video` modal (`fit.ts` picks fill or fit).
- **Lyrics**: `src/lyrics/providers/` (YouTube Music, LRCLIB, lrc.red, NetEase); formats LRC, TTML, plain. A video can carry its own offset; with an unknown offset the lyrics are stretched over the video and flagged "May be out of sync".
- **Library and downloads**: local likes, playlists and follows in SQLite, synced with YouTube Music when signed in. Downloads use a native background URLSession on iOS. Auto-cached songs live in Application Support (excluded from backup) and are evicted least-recently-played first; user downloads are kept.
- **Local files**: `src/local/` scans `Documents/Music` and reads tags via `StreamProxy.readAudioTags`; `isLocalId` guards every YouTube-only code path.
- **CarPlay**: `src/carplay/`; needs the CarPlay entitlement (paid team).
- **TV app** (`src/tv/`): scaled 1440x810 design space (`scale.ts`), D-pad focus via `Focusable`, `modules/tv-keys`, `plugins/withAndroidTV.js` for the leanback manifest. `KeptRoots` in `TVApp.tsx` mounts Home, Search, Library and Settings on first visit and keeps them hidden (`display: none`); `nav.ts` restores each root's last focus. Home data is cached hard (`src/youtube/homeCache.ts`).
- **Phone to TV remote**: `src/remote/protocol.ts` (messages, version 1.2, optional fields only so old phones and TVs keep working); `host.ts` runs on the TV (native server in `modules/sangeet-remote`), `phone.ts` and `client.ts` on the phone. The TV is the authority: snapshots carry song and playing-timeline times, resolved layout, video and lyrics state, quality (published by `src/tv/MirrorPublisher.tsx` while a phone is connected). The phone seeks and skips optimistically, then corrects (`phoneClock.ts`, `seekHold.ts`); it never plays video, `OnTvStrip` shows the TV's state (`remote/tvStatus.ts`). Layout model shared in `src/player/layout.ts`.

## Build, test, release

Settings live in git-ignored env files: `.env.local` (`SANGEET_BUNDLE_ID`, `APPLE_TEAM`), `.env.device` (`APPLE_TEAM`, `IOS_DEVICE`, `TV_SERIAL`), `.env.testflight`.

```sh
scripts/device-build.sh tv|ios [ref]     # incremental build from a warm worktree; INSTALL=1 also installs
scripts/testflight.sh [beta|build|metadata|screenshots|release-prep|certs] [ref]
scripts/android-tv-release.sh            # writes dist/sangeet-tv.apk
npx tsc --noEmit && npx eslint src app && npx jest
```

- iPhone: free Apple team needs `SANGEET_FREE_TEAM=1` (no CarPlay, no Siri; installs expire after 7 days). TestFlight, listing and signing: `docs/INSTALL.md`.
- TV: 32-bit userspace on the Google TV Streamer, so APKs keep both ABIs (`ABIS=arm64-v8a` only for emulator builds). After each install run `adb shell appops set $SANGEET_BUNDLE_ID SYSTEM_ALERT_WINDOW allow`. See `docs/INSTALL-TV.md`.
- Backup server: `server/README.md`. OTA updates stay off until `SANGEET_UPDATES_URL` is set at build time.
- TV performance: `scripts/tv-perf.sh <scenario|all> [label]` against a release build; results go to `dist/tv-perf-<label>.txt`. Use the emulator AVD `sangeet_tv_slow` (`ADB_SERIAL=emulator-5554`).
- Logs: tags `[queue]`, `[video]`, `[lyrics]`, `[remote]`, `[proxy]`, `[resolver]`, `[carplay]`, `[boot]`. TV: `adb logcat -d -s ReactNativeJS:V`. Phone: Settings > Diagnostics.
- Dev driver (debug builds): `xcrun simctl openurl booted "sangeet://search?q=<query>&play=0"`.

## Known gaps

- CarPlay and Siri need a paid Apple team and have not been exercised on a real car or phone.
- Audio quality applies from the next song; the video quality picker lists decoder-capable heights, not the current video's formats; phone-to-TV `setQuality` is untested on a device.
- Nepali/Hindi lyrics sometimes show English words that are not sung (hums, loanwords, wrong LRCLIB matches).
- Video chain: no 24 h miss TTL for new songs (needs an album year on `Track`), no Devanagari transliteration, no "wrong video?" shortcut in Video mode on the phone (the picker is in the "..." menu).
- Some videos have an undeterminable offset (looping audio defeats envelope alignment); lyrics stay synced and show the sync hint.
- Proxy re-resolve on 403 has backoff and client rotation but is still broad; simplify once streaming is stable.
- A liked or playlisted local song whose file was deleted stays in that list and fails like any unplayable song; the phone-to-TV queue hand-over still sends local songs.
- Upstream `react-native-nitro-player` 1.9.0 (workarounds in place): self-pausing after load/skip, `reorderTrackInPlaylist` resetting the current track, no events for remote-command pauses or interruptions, no subscription API outside React.
- Not verified on real hardware: lock-screen controls and long background periods, background downloads, Google sign-in and like sync, real offline relaunch, TV focus with a real remote in the empty states, video sessions over 10 minutes on the TV.
