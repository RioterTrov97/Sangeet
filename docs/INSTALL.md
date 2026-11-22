# Installing Sangeet on iPhone

Set your own bundle ID first: `cp .env.local.example .env.local` and edit `SANGEET_BUNDLE_ID` (Expo reads it for iOS and Android; never edit `ios/`). Keep it stable so installs update in place.

## 1. Build to your iPhone (free Apple account)

A free Personal Team can sign neither the CarPlay nor the Siri entitlement; `SANGEET_FREE_TEAM=1` turns both off (`SANGEET_CARPLAY=0` and `SANGEET_SIRI=0` switch them off individually).

```sh
export LANG=en_US.UTF-8
npm install
SANGEET_FREE_TEAM=1 npx expo prebuild --platform ios --clean
SANGEET_FREE_TEAM=1 npx expo run:ios --device --configuration Release
```

The iPhone must be plugged in, unlocked, trusted and in Developer Mode. If signing fails, open `ios/Sangeet.xcworkspace` once, select your Personal Team under Signing & Capabilities and re-run. Apps signed by a free team stop launching after 7 days: re-run the command (data is kept). Release builds disable the dev deep-link driver (`sangeet://dev?...`), except screenshot builds (`SANGEET_SCREENSHOTS=1`).

## 2. Paid Apple Developer account

1. In Xcode > Signing select the paid team.
2. Request the CarPlay Audio entitlement at developer.apple.com/contact/carplay for your `SANGEET_BUNDLE_ID` (approval takes days to weeks), then enable "CarPlay Audio" for the App ID.
3. Enable the "Siri" capability for the App ID (no application needed).
4. Regenerate the provisioning profiles and build with CarPlay and Siri on (omit `SANGEET_FREE_TEAM`): `npx expo prebuild --platform ios --clean && npx expo run:ios --device --configuration Release`.

## 3. TestFlight

One-time setup:
1. App Store Connect > Users and Access > Integrations > App Store Connect API: create a key (App Manager role) and download `AuthKey_XXX.p8` once. Keep it outside the repo.
2. Create the app record (your `SANGEET_BUNDLE_ID`) in App Store Connect and add yourself as an internal tester.
3. Install Fastlane project-locally: `bundle config set --local path vendor/bundle && bundle install`.
4. `cp .env.testflight.example .env.testflight` and fill in `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`; set `APPLE_TEAM` in `.env.local` (or here).
5. Signing uses fastlane `match`, which stores encrypted certificates in a git repo (`MATCH_GIT_URL`) protected by `MATCH_PASSWORD` (a long random passphrase). Use a **private** git repo (for example a private GitHub repo). For a fully offline setup, a local bare repo works: `git init --bare ~/sangeet-certs.git` and `MATCH_GIT_URL=file://$HOME/sangeet-certs.git`. Never make the certs repo public.
6. Run `scripts/testflight.sh certs` once. It creates your App Store distribution certificate and profile with the API key and stores them in the certs repo. If Apple refuses certificate creation with the API key, run `set -a; . ./.env.local; . ./.env.testflight; set +a; bundle exec fastlane match appstore` in a terminal and sign in with your Apple ID. Never run `match nuke`. For extension targets, add their ids to `SANGEET_EXTRA_BUNDLE_IDS` and map each profile with match's `sigh_<id>_appstore_profile-name` ENV.

`scripts/testflight.sh [beta|build|adhoc|metadata|screenshots|release-prep|certs] [ref]` (no subcommand is `beta`). The ref defaults to `main` and must be committed; a ref that is not an ancestor of `main` is refused unless `ALLOW_ANY_REF=1`. CarPlay stays off until Apple approves the entitlement; then use `SANGEET_CARPLAY=1`.

- `beta`: runs the gates (`tsc`, `eslint`, `jest`; `SKIP_GATES=1` skips them with a warning), builds with build number = latest on TestFlight + 1, uploads, waits for Apple to process the build (up to an hour), attaches **What to Test** (the commit subjects since the previous `testflight/*` tag, last 20 for the first upload) and tags the commit `testflight/<version>-<build>` locally. The tester description comes from `fastlane/metadata/en-AU/beta_description.txt`; `BETA_FEEDBACK_EMAIL` is optional. Internal testers only.
- `build` (or `DRY_RUN=1`): builds the IPA only, to check signing.
- `certs`: the one-time match setup above.
- `screenshots`: builds a Release simulator app with `SANGEET_SCREENSHOTS=1` and captures six 6.9" screenshots on the "iPhone 18 Pro Max" simulator into `fastlane/screenshots/$SANGEET_LISTING_LOCALE/` (default `en-AU`). Needs no Apple account.
- `metadata`: pushes the listing in `fastlane/metadata/` (see its README) to App Store Connect without submitting. Needs `PRIVACY_URL` and `SUPPORT_URL` (host `docs/privacy-policy.html` somewhere); `WITH_SCREENSHOTS=1` also uploads the screenshots. The App Privacy "nutrition label" cannot be set by fastlane: enter it by hand from the end of `docs/privacy-policy.md`.
- `release-prep`: `screenshots`, then `metadata` with them.
- Review submission is manual: `bundle exec fastlane ios submit_review` (needs `REVIEW_FIRST_NAME`, `REVIEW_LAST_NAME`, `REVIEW_EMAIL`, `REVIEW_PHONE`; asks for confirmation; never auto-releases). Apple's guideline 5.2.3 makes approval of a third-party YouTube client unlikely.

`SANGEET_LISTING_LOCALE` (in `.env.testflight`) is the listing language: the folder name under `fastlane/metadata/` and `fastlane/screenshots/`, and the primary language in App Store Connect.

### Ad Hoc builds (Firebase App Distribution)

For testers outside TestFlight: no Apple review, builds last until the Ad Hoc profile expires (one year), up to 100 registered iPhones per membership year (a removed device frees its slot only at renewal).

One-time setup:
1. In the [Firebase console](https://console.firebase.google.com), create a project (Analytics can stay off), add an iOS app with your `SANGEET_BUNDLE_ID` (skip `GoogleService-Info.plist`; the app has no Firebase SDK), open App Distribution and create a tester group.
2. Project settings > Service accounts > generate a private key. Keep the JSON outside the repo (for example next to the App Store Connect key).
3. In `.env.testflight`, set `FIREBASE_APP_ID` (Project settings, `1:…:ios:…`), `FIREBASE_GROUPS` (group alias, comma-separated for several) and `FIREBASE_SERVICE_ACCOUNT_PATH` (CI: `FIREBASE_SERVICE_ACCOUNT_CONTENT`, base64 of the JSON).
4. Invite testers to the group in the Firebase console. On their iPhone they accept the invite and install Firebase's profile, which shares the device UDID with your project.

`scripts/testflight.sh adhoc`: runs the gates, fetches tester UDIDs from Firebase and registers new ones with Apple, creates or refreshes the Ad Hoc profile with `match adhoc` (writes to the certs repo whenever devices changed; it reuses the App Store distribution certificate), builds, uploads to the Firebase group with the commit subjects as release notes, and tags `adhoc/<version>-<build>` locally. Testers get an email and install from the App Distribution page. Rerun it after new testers join, and at least every few months (Firebase keeps a build downloadable for 150 days; installed builds keep working until the profile expires).

UDIDs collected by hand (Finder: select the iPhone, click the text under its name) go in the git-ignored `fastlane/devices.txt`, tab-separated with the header `Device ID	Device Name	Device Platform`. UDIDs are personal data: never commit them.

### Versions and releases (GitHub Actions)

The app version is `package.json`'s `version` (`app.config.ts` reads it; Android `versionCode` is derived from it, 1.2.3 → 10203). It is bumped by [changesets](https://github.com/changesets/changesets), never by hand. Nothing ships until you merge the release PR:

1. With each user-visible change, add a changeset: `npx changeset` (or a file in `.changeset/`, see its README) with `patch`, `minor` or `major` and one or two sentences for testers. Commit it with the change.
2. **Version** runs on every push to `main`. While changesets are pending it keeps one `Release vX.Y.Z` PR up to date on the branch `changeset-release/main`: the version bump, a `CHANGELOG.md` entry and the synced lockfile. The PR grows as more changes land; it never builds or publishes anything.
3. **Merge the release PR** when you want to ship. That starts **Release** for the merge commit: gates, then the iOS build (`adhoc` to Firebase App Distribution) and the signed Android APK (`android` job; one APK for Android phones and Android TV) in parallel, then a GitHub Release `vX.Y.Z` with the CHANGELOG notes and `sangeet-android-vX.Y.Z.apk` attached, plus the same APK as `sangeet-android.apk`. Each release is marked latest, so `https://github.com/<owner>/<repo>/releases/latest/download/sangeet-android.apk` always serves the newest APK (the TV's Downloader code `5597951` points here, see INSTALL-TV.md). The CHANGELOG section is also the Firebase/TestFlight release note.

**Actions > Release > Run workflow** (on `main`) runs the same release by hand, with choices: iOS `adhoc`, `beta` (TestFlight) or `skip`, Android on or off, dry run, skip the gates, Xcode version. Use it to retry a failed release or to send a build to TestFlight.

- **First run, or after changing signing, secrets or Xcode: dry run.** Run Release by hand with `dry_run` on. It runs the gates, builds and signs the iPhone app (App Store signing, `build_only` lane, no upload) and the Android APK, and writes the summary tables, but sends nothing to testers and makes no GitHub Release. It runs even if the version is already released.
- **A release failed** (the version is on `main` but has no `vX.Y.Z` tag): fix the cause and run Release by hand on `main`. Until then, Version fails on purpose (a red X on `main`, plus a comment on the release PR if one is open) instead of bumping past the unreleased version. The rerun ships `main` as it is now: changes merged since the failure are in it, and their notes come with the next version.
- **Changeset reminder:** on pull requests, Checks warns (without failing) when app code changes and no changeset is added. Release refuses to run if `vX.Y.Z` is already released or changesets are still pending, and only the repository owner can start it, by merging or by hand. **Checks** (type check, lint, tests) runs on every pull request and push to `main`; it has no secrets.

One-time setup (all free on a public repo):

- Settings > Actions > General > Workflow permissions: allow GitHub Actions to create and approve pull requests (for the release PR).
- Settings > Environments > New environment `release`: Deployment branches "Selected branches" → `main`. Optional: add yourself as a required reviewer, so each release waits for one more click after the merge. The secrets below can live in this environment (only the `ios` and `android` jobs can read them) or as repository secrets; `SANGEET_BUNDLE_ID` must be a repository secret.
- Optional: Settings > Branches > protect `main` and require the `checks` status check for pull requests.

Standard runners are free on a public repo.

**Logs.** On a public repo, GitHub shows Actions logs to everyone and this cannot be turned off. So build steps run through `scripts/ci-run.sh`: the public log shows each step's result and timing, fastlane's summary lines and, on failure, the last error lines with emails, device IDs and tokens scrubbed. Each job writes a summary table (version and build, where it went, Xcode, APK size, versionCode, SHA-256 of the APK and of its signing certificate). The full logs are uploaded only encrypted, as the 7-day artifacts `logs-ios-encrypted` and `logs-android-encrypted`, when `CI_LOG_PASSPHRASE` is set. To read one:

```bash
gh run download <run-id> -n logs-ios-encrypted && openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in ci-logs-ios.tar.gz.enc -pass pass:"$CI_LOG_PASSPHRASE" | tar xz
```

The IPA is never uploaded to GitHub. For fully private logs, run the workflows from a private copy of the repo instead (private repos use paid runner minutes).

Secrets (the `release` environment, or Settings > Secrets and variables > Actions), made from your local files:

| Secret | From |
| --- | --- |
| `SANGEET_BUNDLE_ID`, `APPLE_TEAM` | `.env.local` |
| `ASC_KEY_ID`, `ASC_ISSUER_ID` | `.env.testflight` |
| `ASC_KEY_CONTENT` | `base64 -i ~/.appstoreconnect/private_keys/AuthKey_XXX.p8 \| pbcopy` |
| `MATCH_GIT_URL`, `MATCH_PASSWORD` | `.env.testflight` (the URL must be `https://`) |
| `MATCH_GIT_BRANCH` (if the certs repo branch is not `master`) | `.env.testflight` |
| `MATCH_GIT_BASIC_AUTHORIZATION` | `printf 'github-user:TOKEN' \| base64 \| pbcopy`, a fine-grained token for the certs repo only, Contents read and write |
| `FIREBASE_APP_ID`, `FIREBASE_GROUPS` | `.env.testflight` |
| `FIREBASE_SERVICE_ACCOUNT_CONTENT` | `base64 -i <service account JSON> \| pbcopy` |
| `ANDROID_KEYSTORE_BASE64` | `base64 -i android-keystore/sangeet-release.jks \| pbcopy` |
| `SANGEET_KEYSTORE_PASSWORD` | `.env.android` |
| `BETA_FEEDBACK_EMAIL` (optional) | |
| `CI_LOG_PASSPHRASE` (recommended) | a long random passphrase you keep in your password manager |

The TV keystore must be the same one local builds use, or installed TVs refuse the update. Keep the local `android-keystore/` and `.env.android` as the master copy. The runner's Xcode is `latest-stable`, or the Release workflow's `xcode` input when run by hand.

Local release commands (`scripts/testflight.sh adhoc|beta`) still work and use commit subjects as release notes.

## 4. OTA JS updates

`expo-updates` stays **off** until you set `SANGEET_UPDATES_URL` at build time. The runtime version is the app version, so an update only reaches builds of the same version: bump `version` when native code changes. The app checks on launch and applies the update on the next launch.

- **EAS Update:** `npm i -g eas-cli && eas login && eas update:configure` (creates a project id), build with `SANGEET_UPDATES_URL=https://u.expo.dev/<project-id>`, ship with `eas update --branch production --message "fix resolver"`.
- **Self-hosted:** `npx expo export --platform ios`, serve `dist/` from a static host with a manifest server such as [expo-updates-server](https://github.com/expo/custom-expo-updates-server), and build with `SANGEET_UPDATES_URL` pointing at its manifest endpoint.

## 5. Streaming broke

1. Settings > Diagnostics: check "Resolver health" and the `[resolver]` log lines. The reason (`403`, `potoken`, `decipher`, `timeout`) says what broke.
2. Update the libraries: `npm update youtubei.js bgutils-js`, `node scripts/build-extractor.mjs`, run `npx jest`.
3. Ship the fix over OTA (section 4), or rebuild.
4. Meanwhile a backup server (`server/README.md`) keeps playback working; downloaded songs always play.

## 6. Look and feel build options

- **Splash:** iOS uses a static launch storyboard chosen at build time: `SANGEET_SPLASH=dark` (default, white glyph on black) or `light`, together with `npx expo prebuild --platform ios --clean`.
- **App icon:** Settings > Appearance > App Icon switches between White on Black (default), Black on White, Green on Black and Classic. Regenerate artwork with `node scripts/build-icons.mjs` (sources in `assets/brand/`).
- **Siri:** needs the Siri capability on the App ID (paid account); `SANGEET_FREE_TEAM=1` or `SANGEET_SIRI=0` builds without it.
