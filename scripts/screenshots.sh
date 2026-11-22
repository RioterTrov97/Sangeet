#!/usr/bin/env bash
# App Store screenshots from a committed ref, on the iPhone 18 Pro Max simulator (6.9").
#   scripts/screenshots.sh [ref]          default ref: main; writes fastlane/screenshots/${SANGEET_LISTING_LOCALE:-en-AU}/NN_name.png
#   SIM_NAME="iPhone 18 Pro Max"          simulator to use (by name; booted if needed)
#   SKIP_BUILD=1 scripts/screenshots.sh   reuse the app already built in the worktree
# Builds Release for the simulator (no signing) with SANGEET_SCREENSHOTS=1, which switches on the dev deep-link driver
# in that build only (never in TestFlight builds). Warm worktree: ~/Library/Caches/sangeet-builds/screenshots, never a clean build.
# Needs network: the simulator is not signed in, so every shot uses anonymous screens (Home, search, albums, a played song).
set -euo pipefail
REF="${1:-main}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${SANGEET_BUILD_ROOT:-$HOME/Library/Caches/sangeet-builds}"
W="$ROOT/screenshots"
OUT="${SCREENSHOTS_OUT:-$REPO/fastlane/screenshots/${SANGEET_LISTING_LOCALE:-en-AU}}"
SIM_NAME="${SIM_NAME:-iPhone 18 Pro Max}"
[ -f "$REPO/.env.local" ] && set -a && . "$REPO/.env.local" && set +a
SANGEET_BUNDLE_ID="${SANGEET_BUNDLE_ID:-com.example.sangeet}"; export SANGEET_BUNDLE_ID
[ "$SANGEET_BUNDLE_ID" != com.example.sangeet ] || echo "warning: SANGEET_BUNDLE_ID is unset (using com.example.sangeet). Copy .env.local.example to .env.local." >&2
BUNDLE="$SANGEET_BUNDLE_ID"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

mkdir -p "$ROOT"
if [ ! -d "$W/.git" ] && [ ! -f "$W/.git" ]; then git -C "$REPO" worktree add --detach "$W" "$REF"; fi
cd "$W"
git checkout -q -f --detach "$(git -C "$REPO" rev-parse "$REF")"
echo "screenshots from $(git log --oneline -1)"

export SANGEET_FREE_TEAM=1 SANGEET_SCREENSHOTS=1 SANGEET_APPLE_TEAM=
stamp() { cat package-lock.json | shasum | cut -c1-16; }
native() {
  { cat package-lock.json app.config.ts; find plugins patches -type f 2>/dev/null | sort | xargs cat 2>/dev/null;
    find modules -type f \( -path "*/ios/*" -o -path "*/android/*" -o -name "expo-module.config.json" -o -name "plugin*" -o -name "app.plugin.js" \) \
      -not -path "*/build/*" -not -path "*/.gradle/*" | sort | xargs cat 2>/dev/null
    echo "screenshots sim $SANGEET_BUNDLE_ID"; } | shasum | cut -c1-16
}
if [ "$(cat .stamp-npm 2>/dev/null)" != "$(stamp)" ] || [ ! -d node_modules ]; then
  S=$(stamp); echo "npm install (lockfile changed)"; npm install --no-audit --no-fund >npm.log 2>&1
  git checkout -q -- package-lock.json; echo "$S" > .stamp-npm
fi
APP="$W/build/Build/Products/Release-iphonesimulator/Sangeet.app"
if [ "${SKIP_BUILD:-0}" != 1 ]; then
  T0=$SECONDS
  if [ "$(cat .stamp-native-screenshots 2>/dev/null)" != "$(native)" ] || [ ! -d ios ]; then
    echo "native inputs changed: expo prebuild (incremental)"
    npx expo prebuild -p ios >prebuild.log 2>&1 || { tail -30 prebuild.log; exit 1; }
  fi
  native > .stamp-native-screenshots
  xcodebuild -workspace ios/Sangeet.xcworkspace -scheme Sangeet -configuration Release -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath build >xcode.log 2>&1 \
    || { grep -E "error:|BUILD FAILED" xcode.log | tail -20; exit 1; }
  echo "simulator app built in $((SECONDS - T0)) s"
fi
[ -d "$APP" ] || { echo "error: $APP missing" >&2; exit 1; }

# Simulator by name (the first match; a booted one wins).
UDID=$(xcrun simctl list devices available -j | python3 -c '
import json,sys
name=sys.argv[1]; best=None
for rt,devs in json.load(sys.stdin)["devices"].items():
    for d in devs:
        if d["name"]==name and (best is None or (d["state"]=="Booted" and best["state"]!="Booted")): best=d
print(best["udid"] if best else "")' "$SIM_NAME")
[ -n "$UDID" ] || { echo "error: no simulator named '$SIM_NAME'" >&2; exit 1; }
WAS_BOOTED=0; xcrun simctl list devices | grep "$UDID" | grep -q Booted && WAS_BOOTED=1
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1
cleanup() { [ "$WAS_BOOTED" = 1 ] || xcrun simctl shutdown "$UDID" 2>/dev/null || true; }
trap cleanup EXIT
echo "simulator $SIM_NAME $UDID"

xcrun simctl ui "$UDID" appearance dark
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
xcrun simctl terminate "$UDID" $BUNDLE 2>/dev/null || true
xcrun simctl uninstall "$UDID" $BUNDLE 2>/dev/null || true # fresh data: nothing signed in, nothing in the library
xcrun simctl install "$UDID" "$APP"

mkdir -p "$OUT"
rm -f "$OUT"/*.png
link() { xcrun simctl openurl "$UDID" "$1"; }
dev() { link "sangeet://dev?cmd=$1&a=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "${2:-}")&b=${3:-}&t=$RANDOM"; }
shot() { sleep "$1"; xcrun simctl io "$UDID" screenshot --type=png "$OUT/$2.png" >/dev/null 2>&1; echo "  $2.png"; }

xcrun simctl launch "$UDID" $BUNDLE >/dev/null
sleep 12
dev quiet; sleep 2
shot 20 01_home

# Library content for the Library shot: a saved album, three liked songs, the album downloading.
dev libdemo "Parachutes Coldplay" dl
link "sangeet://search?q=Coldplay"
shot 18 02_search

link "sangeet://search?q=Parachutes%20Coldplay&type=album&open=0"
shot 18 03_album

link "sangeet://library"
shot 25 04_library

dev playq "Coldplay Yellow"
sleep 12
link "sangeet://player"
shot 10 05_now_playing
link "sangeet://lyrics"
shot 12 06_lyrics

xcrun simctl status_bar "$UDID" clear
for f in "$OUT"/*.png; do echo "$(basename "$f") $(sips -g pixelWidth -g pixelHeight "$f" | awk '/pixel/{printf "%s ", $2}')"; done
