# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo. Read this first, then
[docs/STATUS.md](./docs/STATUS.md) for the current state, the full architecture map and open items.

## Ground rules

- **Do not commit, push, tag or open PRs.** Leave changes in the working tree; the developer reviews and commits
  features. This includes "small" fixes. Say what you changed and what you verified instead.
- **No personal or account data in tracked files.** Bundle ID, Apple team, contacts, URLs, keys and passwords
  live only in git-ignored env files (`.env.local`, `.env.device`, `.env.testflight`, `.env.android`). Use
  `$SANGEET_BUNDLE_ID` in docs and scripts. Never print secrets in logs or output.
- **Never log or store cookies, tokens or PoTokens** in plain text or commit them.
- **Ask before** installing on a real iPhone or TV, sending keys to the real TV, uploading to TestFlight or
  App Store Connect, or anything that creates or changes Apple certificates. Simulators and the Android TV
  emulator (`sangeet_tv`, `sangeet_tv_slow`) are fine for testing.
- Use **npm** (not yarn/pnpm). Set `LANG=en_US.UTF-8` for `expo prebuild` and CocoaPods.

## Project shape

One Expo (SDK 58, Continuous Native Generation) + React Native 0.88 + TypeScript codebase, two apps:

| Target | UI code | Selected by |
| --- | --- | --- |
| iPhone app (CarPlay, Siri) | `app/` (expo-router screens) + `src/ui/` | default |
| Android TV app | `src/tv/` | `Platform.isTV` |

Everything else in `src/` is shared: `player/` (queue, playback intent), `youtube/` (API, stream resolver,
extractor), `db/` (SQLite library), `downloads/`, `lyrics/`, `video/`, `library/`, `remote/` (phone → TV
protocol), `carplay/`, `local/` (files from this iPhone), `import/`, `util/`. See the folder table in
docs/STATUS.md.

## Where things go

- **Screens** for the phone: a route in `app/` that renders a component from `src/ui/`. Keep route files thin.
- **TV screens**: `src/tv/`, using the existing focus primitives in `src/tv/ui.tsx` (`Focusable`) and the scaled
  1440×810 design space (`src/tv/scale.ts`).
- **Logic** (no React): a module in the matching `src/<domain>/` folder, with a colocated `*.test.ts`.
  Prefer plain functions and small stores over logic inside components.
- **Phone and TV are separate**: a change to `src/ui/` must not change `src/tv/` behaviour (and vice versa)
  unless that is the point. Shared behaviour belongs in a shared `src/` module, not copied into both UIs.
- **Native code**: never edit `ios/` or `android/`; they are generated and git-ignored. Use a config plugin
  (`plugins/`), a local Expo module (`modules/<name>/` with `ios/` Swift and `android/` Kotlin), or an
  `app.config.ts` change. Fixes to npm packages go in `patches/` via patch-package.
- **Build-time switches**: env vars read in `app.config.ts` (e.g. `SANGEET_CARPLAY`, `SANGEET_SCREENSHOTS`);
  surface them through `extra` if JS needs them, and document them where they are read.
- **Dev/test hooks**: the deep-link drivers in `src/dev/` (`sangeet://dev?cmd=...`, `sangeet://perf?on=1`) are for
  simulator and emulator testing only and must stay off in release builds.
- **Docs**: keep docs/STATUS.md describing the current state (not history). Update it when you change
  architecture, rules, scripts or known open items. Install and release steps live in docs/INSTALL*.md.

## Building a feature

1. Read the relevant part of docs/STATUS.md and the code you will touch. Look for an existing helper before
   adding one.
2. Make the smallest change that does the job, in the folders above. Match the surrounding style.
3. Add or update unit tests next to the logic you changed (Jest, `*.test.ts`).
4. Run the gates and make them pass:
   ```sh
   npx tsc --noEmit && npx eslint src app && npx jest
   ```
5. Check it in the app when the change is visible: iOS simulator or the Android TV emulator. Device builds are
   incremental and build **committed** code only (`scripts/device-build.sh ios|tv`), so for uncommitted work use
   `npx expo run:ios` on a simulator, or ask the developer.
6. Report: what changed (files), what you verified and how, and what is not verified. Do not commit.

## Things that bite

- Never use `expo prebuild --clean` or clean builds unless native config is truly broken; builds are slow.
- Don't wrap a phone song row in `@react-native-menu/menu`'s `MenuView` (its UIButton swallows taps).
- After editing `src/youtube/extractor/page.ts`, run `npm run build:extractor` (it regenerates the checked-in
  `extractorHtml.generated.ts`).
- nitro-player pauses itself after loading or skipping (`src/player/intent.ts` works around it). UI code should
  control playback through `src/player/` (`queue.ts`, `index.ts` exports), not by calling `TrackPlayer` directly.
- The real TV (Google TV Streamer) runs a 32-bit userspace: TV APKs must keep both ABIs.
- `android-keystore/` and `.env.android` must never be deleted or TV updates stop installing.

## Release (developer-run)

TestFlight and App Store listing go through Fastlane: `scripts/testflight.sh [beta|build|metadata|screenshots|release-prep|certs]`.
Signing uses `match` (certificates in a private repo). Details in docs/INSTALL.md. Agents prepare changes;
the developer runs releases.
