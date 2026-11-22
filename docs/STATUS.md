# Sangeet: developer reference

A music player built from one Expo / React Native codebase for three targets: an iPhone app (CarPlay, Siri, phone-as-TV-remote), an Android phone app (the phone UI, Android Auto, phone-as-TV-remote) and an Android TV app (D-pad UI). One universal Android APK (both ABIs, one signing key) is the phone and TV app: `Platform.isTV` picks the UI (`index.ts`). Sideloaded, updates itself. Streams are resolved on the device; an optional self-hosted server is the fallback.

Stack: Expo SDK 58 (Continuous Native Generation), React Native 0.88, TypeScript, `react-native-nitro-player` (AVPlayer on iOS, Media3 ExoPlayer on Android), youtubei.js in a hidden WebView extractor (PoToken, n-decipher), TanStack Query, SQLite (`src/db`), expo-video.

Working rules (no commits by agents, no personal data in tracked files, what to ask first) are in [AGENTS.md](../AGENTS.md).

## Architecture map

Top level: `app/` (expo-router phone screens), `src/` (all app code), `modules/` (local Expo modules), `plugins/` (`withAndroidTV.js`), `scripts/`, `server/` (optional backup stream server), `patches/` (patch-package), `assets/`.

| `src/` folder | Purpose |
| --- | --- |
| `auth` | Google sign-in cookies (keychain only, `yt.cookie.v2`; YouTube's cookie values win over Google's when merged, and an old `v1` header asks for a fresh sign-in) and the signed-in store, plus the account's display name, handle and photo URL (`auth.account.v1`, non-secret, refreshed at most daily via `getAccountInfo`; the avatar menu and Settings show it) |
| `boot.ts` | Headless start-up shared by the phone UI, CarPlay and the TV |
| `androidauto` | Android Auto browse tree (`tree.ts` pure, `index.ts` wiring); lists are native playlists named `aa:<context>`, adopted as the queue when the car plays from one (`adoptIfFromCar`). Search: the car's search button (voice while driving, keyboard when parked) and "Hey Google, play X on Sangeet" (nitro-player's voice fallback plays the first song) both use `searchResults` (top songs as one list, then albums and artists); car searches join the phone's recent searches (`search.recent`), shown under Home > Recent searches. Build switch `SANGEET_ANDROID_AUTO` (default on, `app.config.ts`) |
| `carplay` | CarPlay templates (Home, Library, Recents, Downloads), built from cache so a cold launch works without the phone UI |
| `db` | SQLite client, schema, migrations, repository |
| `dev` | Dev deep-link driver (`sangeet://dev?...`) and perf driver (`sangeet://perf?on=1`); the dev driver is off in release builds except screenshot builds (`SANGEET_SCREENSHOTS=1`) |
| `downloads` | Background downloads, whole-song auto cache, LRU eviction, offline detection |
| `home` | Home shelves, layout, personalisation. Signed in (phone), For you leads with the account's YT Quick picks (paged 4-row grid, up to 20), a Your Supermix button, the account's feed shelves in YouTube's order (`accountFeed` hides our Mixes / Recently played when the account has its own), then library shelves (playlists, Liked songs) and our personal rows |
| `import` | Spotify playlist import and matching to YouTube tracks |
| `library` | Likes, playlists, follows, pins, YouTube library sync |
| `link` | YouTube / YouTube Music link parsing (`musicLink.ts`, shared with the TV), playing a link (`playLink.ts`), shared text parsing incl. Spotify (`shared.ts`) |
| `local` | Songs from this device (iPhone: `Documents/Music` shown in Files; Android: the document picker copies into the app's music folder): scan, tags, `local-<hash>` ids |
| `lyrics` | Lyrics providers, parsing, timing clock, prefetch |
| `player` | Queue, store, playback intent, recovery, history (`mergeHistory` blends this phone's plays with the account's all-devices history for Home and History when signed in; remote history is never written to SQLite), bridge to nitro-player |
| `remote` | Phone to TV remote protocol, host and client |
| `search` | Recent searches, suggestion model, mood tiles |
| `siri` | Siri intent handling (guarded by Info.plist flag `SangeetSiriEntitled`) |
| `tv` | The whole TV app |
| `update` | Android in-app updater (platform-neutral logic and store; UI: TV `src/tv/UpdateTV.tsx` and Settings, phone `src/ui/UpdatesSection.tsx` and `UpdateBanner.tsx`). Native side: `modules/app-updater` |
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
- **Android phone** (same code as iPhone, `Platform.OS === 'android'` gates, never changing iOS): `src/ui/Icon.tsx` renders SF Symbol names as Material Symbols on Android (`iconNames.ts`; `iconNames.test.ts` fails for an unmapped name). `modules/audio-events` reports audio-focus interruptions and notification / headset / Bluetooth commands to `src/player/audioEvents.ts` (the nitro-player patch broadcasts them, see `patches/`). `modules/route-picker` opens the system output switcher, `modules/sangeet-remote` has the NSD client (`RemoteClient.kt`) next to the TV host, `modules/share-intent` hands over `ACTION_SEND` text (`src/ui/incomingLinks.ts` also takes `ACTION_VIEW` links; `app/+native-intent.ts` keeps them off the router), `plugins/withAndroidTV.js` writes the manifest (no fixed orientation, share and view filters, Android Auto descriptor). Portrait is locked per screen by expo-router, full-screen video is landscape. POST_NOTIFICATIONS is requested at the first play (`src/player/notifyPermission.ts`).
- **TV app** (`src/tv/`): scaled 1440x810 design space (`scale.ts`), D-pad focus via `Focusable`, `modules/tv-keys`, `plugins/withAndroidTV.js` for the leanback manifest. `KeptRoots` in `TVApp.tsx` mounts Home, Search, Library and Settings on first visit and keeps them hidden (`display: none`); `nav.ts` restores each root's last focus. Home data is cached hard (`src/youtube/homeCache.ts`).
- **Android updater** (`src/update/`, `modules/app-updater`): off unless `SANGEET_UPDATE_REPO` (owner/name, set by the Release workflow) is baked into the build (`extra.updateRepo`). It reads the repo's GitHub Releases (`/releases?per_page=10`, pre-releases included), picks the newest newer version with a `sangeet-android-vX.Y.Z.apk` (or older `sangeet-tv-v*`) asset, downloads it to `cacheDir/updates` (SHA-256 checked when GitHub gives a digest) and installs through `PackageInstaller`. Checks at start (after Home) and every 6 h; with "Install updates automatically" on (default) it downloads at once and installs only when nothing is playing (at launch and when playback stops); otherwise the Home pill / Settings > Updates Update button does it. Needs "Install unknown apps" allowed for Sangeet once; later installs of the same signing key may be silent on Android 12+. Test against a local feed with a screenshot build: `SANGEET_SCREENSHOTS=1 SANGEET_UPDATE_FEED=http://127.0.0.1:8099/releases` (the override is ignored in other builds).
- **Signed-in requests**: `src/youtube/cryptoPolyfill.ts` gives Hermes the SHA-1 digest and `randomUUID` youtubei.js needs to sign requests (SAPISIDHASH); `src/youtube/authedFetch.ts` adds the `Origin` header the signature is checked against (youtubei.js sets it only on servers) and keeps iOS's shared cookie store out. Without either, YouTube answers signed-in requests as logged out. Verified on the iOS simulator with a real account. Adding plays to the account's YouTube history is on by default when signed in (Settings turns it off; `reportHistory` in `src/auth/store.ts`); `reportYtPlayback` uses a second session that downloads the player script, because the player request needs its signatureTimestamp to return the tracking URL.
- **Recap** (phone, signed in): route `app/recap.tsx` -> `src/ui/RecapScreen.tsx`, opened from the avatar menu; `getRecap` / `getRecapTracks` in `src/youtube/api.ts`, mapped in `src/youtube/mappers/account.ts` (also the account menu and history parsers). These endpoints are not covered by tests against live data.
- **YouTube Music playlists** (phone, signed in): `addToPlaylistPage` (`src/ui/actions.tsx`) lists the account's playlists (`addableYtPlaylists` in `src/library/ytPlaylists.ts`: synced YT rows, owned by the account name else `PL...` ids, no LM/SE/RD*) and can create one on YouTube Music or on the phone; `addToYtPlaylist` / `createYtPlaylist` in `src/youtube/api.ts`. Not covered by tests against live data.
- **Followed releases**: YouTube subscriptions sync into followed artists, so "New from artists you follow" (16 artists when signed in) covers them.
- **Phone to TV remote**: `src/remote/protocol.ts` (messages, version 1.2, optional fields only so old phones and TVs keep working); `host.ts` runs on the TV (native server in `modules/sangeet-remote`), `phone.ts` and `client.ts` on the phone. The TV is the authority: snapshots carry song and playing-timeline times, resolved layout, video and lyrics state, quality (published by `src/tv/MirrorPublisher.tsx` while a phone is connected). The phone seeks and skips optimistically, then corrects (`phoneClock.ts`, `seekHold.ts`); it never plays video, `OnTvStrip` shows the TV's state (`remote/tvStatus.ts`). Layout model shared in `src/player/layout.ts`.

## Build, test, release

Settings live in git-ignored env files: `.env.local` (`SANGEET_BUNDLE_ID`, `APPLE_TEAM`), `.env.device` (`APPLE_TEAM`, `IOS_DEVICE`, `TV_SERIAL`), `.env.testflight`.

```sh
scripts/device-build.sh tv|ios [ref]     # incremental build from a warm worktree; INSTALL=1 also installs
scripts/testflight.sh [beta|build|adhoc|metadata|screenshots|release-prep|certs] [ref]
scripts/android-tv-release.sh            # writes dist/sangeet-tv.apk (the universal Android APK: phone and TV; the Release workflow publishes it as sangeet-android-vX.Y.Z.apk)
npx changeset                            # describe a user-visible change (the version comes from changesets)
npx tsc --noEmit && npx eslint src app && npx jest
```

- iPhone: free Apple team needs `SANGEET_FREE_TEAM=1` (no CarPlay, no Siri; installs expire after 7 days). TestFlight, listing and signing: `docs/INSTALL.md`.
- Android: 32-bit userspace on the Google TV Streamer, so APKs keep both ABIs (`ABIS=arm64-v8a` only for emulator builds). Phone install: `docs/INSTALL-ANDROID.md`. Emulators: `sangeet_phone` (Pixel 8, Play Store image, API 36), `sangeet_tv`, `sangeet_tv_slow`. After each install run `adb shell appops set $SANGEET_BUNDLE_ID SYSTEM_ALERT_WINDOW allow`. See `docs/INSTALL-TV.md`.
- CI: **Checks** on every PR and push to `main`; **Version** keeps one `Release vX.Y.Z` PR (`changeset-release/main`) up to date from pending changesets; merging it (owner only) starts **Release** (iOS Ad Hoc to Firebase, Android APK, GitHub Release), which can also be run by hand (`dry_run` builds and signs without sending). Version stops, without bumping, while a version on `main` is unreleased (a failed release); Checks warns on PRs that change app code without a changeset. Signing secrets are used only by Release's `ios` and `android` jobs (`release` environment). Rules: AGENTS.md; setup: `docs/INSTALL.md`.
- Backup server: `server/README.md`. OTA updates stay off until `SANGEET_UPDATES_URL` is set at build time.
- TV performance: `scripts/tv-perf.sh <scenario|all> [label]` against a release build; results go to `dist/tv-perf-<label>.txt`. Use the emulator AVD `sangeet_tv_slow` (`ADB_SERIAL=emulator-5554`).
- Logs: tags `[queue]`, `[video]`, `[lyrics]`, `[remote]`, `[proxy]`, `[resolver]`, `[carplay]`, `[boot]`. TV: `adb logcat -d -s ReactNativeJS:V`. Phone: Settings > Diagnostics.
- Dev driver (debug builds): `xcrun simctl openurl booted "sangeet://search?q=<query>&play=0"`.

## Known gaps

- Android phone: no filled icon variants (Material Symbols font has one weight), alternate app icons, Siri and CarPlay are iOS only, songs picked on Android live in app storage (not visible in other apps), Google sign-in on Android is untested on a device, Android Auto is unit-tested (browse tree) and the system's media browser connects to the service, but it has not been run in the Desktop Head Unit or a car (the emulator image has no Android Auto app, so the DHU cannot start), no like button in the media notification yet.

- CarPlay and Siri need a paid Apple team and have not been exercised on a real car or phone.
- Audio quality applies from the next song; the video quality picker lists decoder-capable heights, not the current video's formats; phone-to-TV `setQuality` is untested on a device.
- Nepali/Hindi lyrics sometimes show English words that are not sung (hums, loanwords, wrong LRCLIB matches).
- Video chain: no 24 h miss TTL for new songs (needs an album year on `Track`), no Devanagari transliteration, no "wrong video?" shortcut in Video mode on the phone (the picker is in the "..." menu).
- Some videos have an undeterminable offset (looping audio defeats envelope alignment); lyrics stay synced and show the sync hint.
- Proxy re-resolve on 403 has backoff and client rotation but is still broad; simplify once streaming is stable.
- A liked or playlisted local song whose file was deleted stays in that list and fails like any unplayable song; the phone-to-TV queue hand-over still sends local songs.
- Upstream `react-native-nitro-player` 1.9.0 (workarounds in place): self-pausing after load/skip, `reorderTrackInPlaylist` resetting the current track, no events for remote-command pauses or interruptions, no subscription API outside React.
- Not verified on real hardware: lock-screen controls and long background periods, background downloads, Google sign-in and like sync on a real iPhone (simulator verified), real offline relaunch, TV focus with a real remote in the empty states, video sessions over 10 minutes on the TV.
