# Installing Sangeet on an Android phone

One APK serves Android phones and Android TV: on a phone it shows the phone UI (the same screens as the iPhone app), on a TV the
D-pad UI ([INSTALL-TV.md](./INSTALL-TV.md)). It is sideloaded; there is no Play Store listing. Needs Android 8 or newer (media
notification controls and sharing links work best on Android 13+).

## Install

1. Get `sangeet-android-vX.Y.Z.apk` from the repository's **Releases** page (or build it, below) onto the phone.
2. Open it. Android asks once to allow installs from the app you opened it with (browser or file manager): allow it.
3. Open Sangeet. The first time music plays it asks to show notifications (Android 13+): allow it, or the media notification and the
   lock-screen controls stay hidden.

Or over USB: `adb install -r sangeet-android-vX.Y.Z.apk`.

## Updates

Sangeet checks GitHub Releases (at start and every 6 hours) and shows an **Update ready** banner. **Settings > Updates** has the version,
**Check for updates**, **Install update** and **Install updates automatically** (on by default: it downloads in the background and
installs only when nothing is playing). The first install from inside the app needs **Install unknown apps** allowed for Sangeet
(the button in Settings > Updates opens that screen). Every update must be signed with the same key as the installed app.

## What is different from the iPhone app

- **Songs from this phone:** Library > Import songs opens the Android file picker; picked audio is copied into the app's own music
  folder (not visible in other apps).
- **Output:** the output button opens the Android sound output switcher (speakers, Bluetooth, Cast); a Sangeet TV on the network
  is listed there too, so the phone can control it.
- **Share to Sangeet:** share a YouTube, YouTube Music or Spotify playlist/album link from any app and choose Sangeet; links to
  those sites also offer to open in Sangeet.
- **Android Auto:** connect the phone to a car (or the Desktop Head Unit) and Sangeet appears in the media apps: Home, Library,
  Recents, Downloads, search. Turn it off at build time with `SANGEET_ANDROID_AUTO=0`.
- **No alternate app icons, Siri or CarPlay** on Android.

## Build it yourself

```sh
scripts/android-tv-release.sh      # signed release APK: dist/sangeet-tv.apk (the same file works on phones; ABIS=arm64-v8a for a quick one)
```

JDK 17 and the Android SDK as in INSTALL-TV.md. Use the same keystore (`android-keystore/`, `.env.android`) as for the TV, or
installed copies will refuse the update. Try it on the emulator: create an AVD from `system-images;android-36;google_apis_playstore;arm64-v8a`
(device `pixel_8`), start it, then `adb install -r dist/sangeet-tv.apk`.

Android Auto on a Mac: install **Android Auto Desktop Head Unit** (SDK Manager > SDK Tools), in the phone's Android Auto developer
settings start the head unit server, `adb forward tcp:5277 tcp:5277`, then run `desktop-head-unit`.
