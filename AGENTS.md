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

One Expo (SDK 58, Continuous Native Generation) + React Native 0.88 + TypeScript codebase, three targets, two apps (one Android APK covers the phone and the TV):

| Target | UI code | Selected by |
| --- | --- | --- |
| iPhone app (CarPlay, Siri) | `app/` (expo-router screens) + `src/ui/` | default |
| Android phone app (Android Auto) | `app/` + `src/ui/`, with `Platform.OS === 'android'` gates | default, on a phone |
| Android TV app | `src/tv/` | `Platform.isTV` |

Everything else in `src/` is shared: `player/` (queue, playback intent), `youtube/` (API, stream resolver,
extractor), `db/` (SQLite library), `downloads/`, `lyrics/`, `video/`, `library/`, `remote/` (phone → TV
protocol), `carplay/`, `androidauto/` (Android Auto browse tree), `link/` (shared YouTube / Spotify link parsing and playing), `update/` (Android in-app updater), `local/` (songs from this phone), `import/`, `util/`. See the folder table in
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
   For a user-visible change, add a changeset (`.changeset/<short-name>.md`: `"sangeet": patch|minor|major` and one
   or two plain sentences for testers; see `.changeset/README.md`). Never edit the version or CHANGELOG.md by hand.
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

## Release and CI (developer-run)

Versions come from changesets (see "Building a feature"). Three GitHub workflows; only Release signs or publishes:

| Workflow | Runs on | Does |
| --- | --- | --- |
| `.github/workflows/checks.yml` | every PR and push to `main` | tsc, eslint, jest; on PRs, a warning (never a failure) when app code changes without a changeset; no secrets |
| `.github/workflows/version.yml` | push to `main`, or by hand | pending changesets → one growing `Release vX.Y.Z` PR on `changeset-release/main` (package.json version, CHANGELOG.md, lockfile); never builds. Fails on purpose, without bumping, while main's version has no tag but an earlier release does (a failed release) |
| `.github/workflows/release.yml` | the owner merging that PR, or the owner by hand on `main` | gates → iOS (`adhoc` to Firebase App Distribution, or `beta` to TestFlight) and the signed Android APK (`android` job: one universal APK for phones and TV, published as `sangeet-android-vX.Y.Z.apk`) → GitHub Release `vX.Y.Z` with the notes and APK. Manual `dry_run` builds and signs both apps (iOS `build_only` lane) and sends nothing |

Pieces: `fastlane/Fastfile` (lanes `adhoc`, `beta`, `build_only`, `metadata`, `certs`), `scripts/testflight.sh`
(the same lanes from a Mac), `scripts/android-tv-release.sh` (the universal Android APK, `dist/sangeet-tv.apk`), `scripts/release-notes.mjs` (CHANGELOG section),
`scripts/ci-run.sh` and `scripts/ci-logs-encrypt.sh` (quiet logs). Secrets and setup: docs/INSTALL.md.

How a release happens (what to tell the developer, and what the workflows assume):
1. A user-visible change lands on `main` with a changeset (`.changeset/<name>.md`). Agents add the changeset; they never
   bump `package.json` or edit `CHANGELOG.md`, and never edit the `changeset-release/main` branch or its PR.
2. Version rebuilds the release PR from `main` on every push. The developer merges it when they want to ship.
3. The merge starts Release (iOS Ad Hoc to Firebase, Android APK, GitHub Release `vX.Y.Z`). Phones and TVs update
   themselves from the GitHub Release.

When a release fails, the version is on `main` with no tag. The fix is to rerun Release by hand on `main` (Actions >
Release > Run workflow), not to add changesets: Version refuses to bump past an unreleased version (red X on `main`)
until that rerun succeeds. A rerun ships `main` as it is now; changes merged since then are in that build, and their
changesets go into the next version. To test the pipeline (first setup, new runner, Xcode or signing change), suggest a
manual run with `dry_run` on: it needs the same secrets, builds and signs both apps, and sends nothing to testers or to
GitHub Releases. Agents can read run results (`gh run list`, `gh run view <id>`) but never start, rerun or cancel a
Release run, approve the `release` environment or merge the release PR; those are the developer's.

Rules for changing CI:
- **Nothing deploys on its own.** Release runs only on `workflow_dispatch` (owner, `main`) or on the merge of the
  release PR (`pull_request: closed`, guarded: merged, head `changeset-release/main` from this repo, merged by the owner;
  it checks out `merge_commit_sha`). Never add a push, tag, schedule or other pull_request trigger to a workflow that
  signs, uploads or publishes, and never loosen that guard. Jobs that read signing or upload secrets use
  `environment: release`. Checks and Version must never receive secrets or sign anything. Workflows get the least
  `permissions` they need (`contents: read` by default).
- **The repo is public, so Actions logs and artifacts are public.** Run every build or upload command through
  `scripts/ci-run.sh <name> <cmd>` (full output to a file; the log shows only summary and scrubbed error lines). Never
  `cat`, `echo` or `set -x` anything that could hold a secret, a tester's email or device, the bundle ID or team, and
  never print env. Put the useful facts in `$GITHUB_STEP_SUMMARY` (version, build, where it went, hashes) instead.
- **Artifacts:** never upload an IPA, a keystore, a key, an env file or a raw log. Full logs go up only through
  `scripts/ci-logs-encrypt.sh` (encrypted with `CI_LOG_PASSPHRASE`). The Android APK goes only to the GitHub Release.
- **Secrets** live only in GitHub secrets (repository or the `release` environment) and git-ignored env files. Values derived from a secret are not
  masked automatically: mask them with `::add-mask::` before anything can print them. Decode key files into the
  runner's temp or a git-ignored path, and delete them in an `if: always()` step.
- Pin actions to a major version from the publisher (`actions/*`, `ruby/setup-ruby`, `maxim-lobanov/setup-xcode`); do
  not add third-party actions that receive secrets without asking the developer.
- Changing signing (new profiles, certificates, keystore) or adding a secret needs the developer's go-ahead.

Before finishing any change, check that it leaks nothing:
```sh
git grep -n -i -E "BEGIN (RSA |EC )?PRIVATE KEY|AuthKey_[A-Z0-9]{10}\.p8|@gmail|@icloud|/Users/[a-z]" -- ':!*.lock' ':!package-lock.json'
git status --short   # nothing untracked that should be ignored (env files, keys, devices.txt, logs)
```

### Local release

TestFlight, Firebase and the App Store listing also run from a Mac: `scripts/testflight.sh [beta|build|adhoc|metadata|screenshots|release-prep|certs]`.
Signing uses `match` (certificates in a private repo). Details in docs/INSTALL.md. Agents prepare changes;
the developer runs releases.
