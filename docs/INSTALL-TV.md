# Installing Sangeet on Google TV / Chromecast with Google TV

The Android build of Sangeet is a TV app (D-pad UI, plays music itself). It is sideloaded with `adb`; there is no Play Store listing.

## 1. Build the APK (on the Mac)

```sh
scripts/android-tv-release.sh      # writes dist/sangeet-tv.apk
```

Needs JDK 17 (`brew install openjdk@17`) and the Android SDK at `~/Library/Android/sdk` (platform-tools, platform 36/37, build-tools, NDK 27.1, cmake 3.22). The first run creates a signing key in `android-keystore/` and its password in `.env.android`. Both are gitignored: keep them, because every update must be signed with the same key or `adb install -r` will refuse it.

## 2. Enable developer options on the Chromecast

1. Settings > System > About > tap **Android TV OS build** 7 times.
2. Settings > System > Developer options > turn on **USB debugging**, and **Wireless debugging** (or **Network debugging** on older builds).

## 3. Connect with adb

With **Wireless debugging** (pairing code):

```sh
adb pair <tv-ip>:<pairing-port>      # enter the 6-digit code shown on the TV
adb connect <tv-ip>:<connect-port>   # the port on the Wireless debugging screen
```

With **Network debugging** (older builds):

```sh
adb connect <tv-ip>:5555
```

`adb devices` should now list the TV.

## 4. Install

```sh
adb install -r dist/sangeet-tv.apk
```

Then allow "display over other apps" so the phone can start Sangeet when it is closed (one-time, survives updates):

```sh
adb shell appops set $SANGEET_BUNDLE_ID SYSTEM_ALERT_WINDOW allow
adb shell monkey -p $SANGEET_BUNDLE_ID -c android.intent.category.LEANBACK_LAUNCHER 1   # open once so the background service starts
```

Sangeet appears in the Google TV apps row (Apps > Sangeet, with its banner). To start it from the Mac: `adb shell monkey -p $SANGEET_BUNDLE_ID -c android.intent.category.LEANBACK_LAUNCHER 1`.

## Updating

Rebuild and run the same `adb install -r dist/sangeet-tv.apk`. Your library (likes, history, follows) stays on the TV.

## Using it

- D-pad moves between cards, OK plays or opens, Back goes up one screen (Back on Home asks before exiting).
- Play/pause, next and previous remote keys work anywhere.
- Search: focus the field and press OK to open the TV keyboard (the microphone key dictates).
- Now Playing: on the progress bar, Left/Right seek 10 s. Buttons: previous, play, next, like, shuffle, lyrics, video.
- Sign-in is not available on the TV; its library is local to the TV.

## YouTube Music links

Sangeet on the TV plays YouTube Music links handed to it as `sangeet://open?url=<link>` (the custom TV launcher sends `music.youtube.com` links this way):

- a song (`/watch?v=…`, `youtu.be/…`) plays and continues as radio; with `&list=…` it plays that playlist or album from the song; a `t=` start time (`t=90`, `t=1m30s`) is kept;
- an album (`/browse/MPREb_…`, or its `/playlist?list=OLAK5uy_…` form) or a playlist (`/playlist?list=…`, `/browse/VL…`) plays from the top;
- an artist (`/channel/UC…`, `/browse/UC…`) opens the artist page.

Now Playing shows "Starting playback from YouTube Music…" while it loads. Links it cannot play (radio mixes, Explore, Home) show a short notice. Sangeet does not claim `https://music.youtube.com` links itself, so it never competes with the launcher for them. To try one from the Mac:

```sh
adb shell am start -a android.intent.action.VIEW -d 'sangeet://open?url=https%3A%2F%2Fmusic.youtube.com%2Fbrowse%2FMPREb_oBucXyijinj'
```

## Phone as remote (iPhone)

A small background service on the TV (started at boot and when Sangeet is opened) advertises the TV on the home network (`_sangeet._tcp`, TCP port 8765) and listens for the phone, even when the Sangeet screen is closed. There is no pairing: it is for your home Wi-Fi only (the TV refuses connections from outside the local network).

1. On the iPhone, a TV icon appears next to the mini-player / player controls when a Sangeet TV is found on the network. (If you never see it, allow Local Network access for Sangeet in iOS Settings.)
2. Tap it: one TV connects directly; with several, pick one. Songs, playlists and tiles you play now play on the TV; the icon is tinted and the player says "Playing on <TV>". Tap the icon again to disconnect: the TV keeps playing; the phone just stops controlling it (reconnect any time to pick up what the TV is playing).
3. If Sangeet is closed (or the Chromecast is in standby) the TV wakes, starts Sangeet and plays; "Starting Sangeet on <TV>…" shows on the phone meanwhile. Waking the TV itself relies on HDMI-CEC ("One Touch Play") being enabled in the Chromecast settings, and the appops command above.
4. The TV's own remote keeps working and the phone follows. If the TV is silent for more than 5 seconds the phone shows a banner and reconnects by itself.

Developer/testing: Settings > Diagnostics > "Sangeet TV: connect by IP" (for example `127.0.0.1:8765` after `adb forward tcp:8765 tcp:8765`).
