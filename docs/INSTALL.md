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

`scripts/testflight.sh [beta|build|metadata|screenshots|release-prep|certs] [ref]` (no subcommand is `beta`). The ref defaults to `main` and must be committed; a ref that is not an ancestor of `main` is refused unless `ALLOW_ANY_REF=1`. CarPlay stays off until Apple approves the entitlement; then use `SANGEET_CARPLAY=1`.

- `beta`: runs the gates (`tsc`, `eslint`, `jest`; `SKIP_GATES=1` skips them with a warning), builds with build number = latest on TestFlight + 1, uploads, waits for Apple to process the build (up to an hour), attaches **What to Test** (the commit subjects since the previous `testflight/*` tag, last 20 for the first upload) and tags the commit `testflight/<version>-<build>` locally. The tester description comes from `fastlane/metadata/en-AU/beta_description.txt`; `BETA_FEEDBACK_EMAIL` is optional. Internal testers only.
- `build` (or `DRY_RUN=1`): builds the IPA only, to check signing.
- `certs`: the one-time match setup above.
- `screenshots`: builds a Release simulator app with `SANGEET_SCREENSHOTS=1` and captures six 6.9" screenshots on the "iPhone 18 Pro Max" simulator into `fastlane/screenshots/$SANGEET_LISTING_LOCALE/` (default `en-AU`). Needs no Apple account.
- `metadata`: pushes the listing in `fastlane/metadata/` (see its README) to App Store Connect without submitting. Needs `PRIVACY_URL` and `SUPPORT_URL` (host `docs/privacy-policy.html` somewhere); `WITH_SCREENSHOTS=1` also uploads the screenshots. The App Privacy "nutrition label" cannot be set by fastlane: enter it by hand from the end of `docs/privacy-policy.md`.
- `release-prep`: `screenshots`, then `metadata` with them.
- Review submission is manual: `bundle exec fastlane ios submit_review` (needs `REVIEW_FIRST_NAME`, `REVIEW_LAST_NAME`, `REVIEW_EMAIL`, `REVIEW_PHONE`; asks for confirmation; never auto-releases). Apple's guideline 5.2.3 makes approval of a third-party YouTube client unlikely.

`SANGEET_LISTING_LOCALE` (in `.env.testflight`) is the listing language: the folder name under `fastlane/metadata/` and `fastlane/screenshots/`, and the primary language in App Store Connect.

`.github/workflows/testflight.yml` is an unused template; its header lists what it needs (a GitHub remote, the certs repo as a private GitHub repo, secrets).

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
