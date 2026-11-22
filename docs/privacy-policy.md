# Sangeet privacy policy

Effective 22 November 2026.

Sangeet is a music player for iPhone. This page says what the app stores on your device and what leaves it. Short version: the app has no analytics, no advertising and no tracking, and nothing about you is sold or shared with anyone.

## What stays on your device

- **Your library**: likes, saved albums, followed artists, playlists, recent searches, play history and settings are stored in a local database and local storage on your iPhone.
- **Downloads and cache**: songs you download, and songs the app caches while you listen, are files in the app's storage on your iPhone. You can delete them in the app (Settings) or by deleting the app.
- **Songs from this iPhone**: audio files you import from the Files app are copied into the app's Documents/Music folder. Their tags and cover art are read on the device.
- **Sign-in**: if you choose to sign in, you do it on Google's own sign-in page shown inside the app. Sangeet never sees your password. After sign-in the app stores the resulting session cookies in the iOS keychain on your iPhone, and uses them only to talk to YouTube Music as you. Signing out removes them.
- **Voice search**: if you use voice search, speech is turned into text by Apple's speech recognition. Sangeet does not record or keep the audio.

## What leaves your device

The app talks to the services that provide the music and the extras you ask for. Those services see your IP address and the request itself, as with any web request, and they have their own privacy policies.

- **YouTube Music and Google**: searches, browsing, stream requests and, if you are signed in, your library, recommendations and the playback and like actions you make. This is the app's main function.
- **Lyrics providers**: when you open lyrics, the song title, artist and length are sent to lyrics services (LRCLIB, lrc.red, NetEase Cloud Music) to look up lyrics, as well as to YouTube Music. You can turn each source off in Settings.
- **Spotify playlist import**: if you paste a public Spotify playlist or album link, the app fetches that public page from Spotify to read the track list, then matches the tracks on YouTube Music. Nothing is sent to your Spotify account.
- **Backup server (optional)**: if you add your own backup stream server in Settings, the app sends it the song it needs to resolve, with the access token you set. That server is run by you, not by Sangeet.
- **Google TV (optional)**: if you control a Google TV running Sangeet, the phone and the TV talk to each other directly on your local network. The app asks for local network access for this. Nothing goes through a Sangeet server, and there is none.

## What Sangeet does not do

- No analytics, crash reporting, advertising or tracking libraries are in the app.
- No data is sold, rented or shared with third parties for their own purposes.
- No account with Sangeet exists, so there is nothing to delete on our side.

## Children

Sangeet is not directed at children and collects no personal information from anyone.

## Changes

If this policy changes, the new version will be posted here with a new effective date.

## Contact

Questions about this policy: use the support page linked from the app's App Store listing.

---

## App Privacy answers for App Store Connect (enter by hand; fastlane cannot set these)

Everything from here down is a working note and is not part of the hosted `privacy-policy.html`.

App Store Connect > App > App Privacy. These match what the code does today; re-check them when features change.

- **Do you or your third-party partners collect data from this app?** The developer receives nothing: no data is sent to the developer, and the app has no analytics or advertising service. The app is a client for the user's own YouTube Music account and its requests go to YouTube and Google.
- **Recommended answer: "Data Not Collected"** in every category.
- **Conservative alternative**, if you would rather declare what the app sends to Google while signed in: Search History and Usage Data (plays and likes), each "linked to the user", not used for tracking, purpose "App Functionality". Nothing else applies.
- **Tracking**: "No, this app does not track users". No advertising identifier is read (no ATT prompt is needed).
- **Privacy policy URL**: the hosted `docs/privacy-policy.html` (`PRIVACY_URL`).
- **Other App Store Connect questions**: age rating answers are pushed from `fastlane/metadata/app_rating_config.json`; encryption: the app uses only standard HTTPS, answer that it uses exempt encryption.
