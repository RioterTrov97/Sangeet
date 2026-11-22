#!/usr/bin/env bash
# Fast, incremental device builds from a committed ref, in warm build folders that persist between runs.
#   scripts/device-build.sh tv  [ref]     -> <root>/tv/dist/sangeet-tv.apk   (also copied to dist/ here)
#   scripts/device-build.sh ios [ref]     -> <root>/ios/build/Build/Products/Release-iphoneos/Sangeet.app
#   INSTALL=1 scripts/device-build.sh ios        also installs on the iPhone (IOS_DEVICE=<udid>)
#   INSTALL=1 scripts/device-build.sh tv         also installs on the TV (TV_SERIAL=<adb serial>)
#   ABIS=arm64-v8a scripts/device-build.sh tv    one ABI (faster; default both, the Streamer may run 32-bit userspace)
#
# Why it is fast: each platform has its own long-lived git worktree (default ~/Library/Caches/sangeet-builds/<platform>),
# so node_modules, Pods, Gradle and Xcode DerivedData stay warm. `npm install` runs only when package-lock.json changed and
# `expo prebuild` (never --clean) only when native inputs changed (lockfile, app.config.ts, plugins/, modules/ native
# code, patches/). Otherwise it is just the incremental Gradle / xcodebuild step plus the JS bundle.
# Builds only committed code, so work in progress in the main checkout never leaks into an install.
set -euo pipefail
PLATFORM="${1:?usage: device-build.sh ios|tv [ref]}"
REF="${2:-main}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${SANGEET_BUILD_ROOT:-$HOME/Library/Caches/sangeet-builds}"
W="$ROOT/$PLATFORM"
export LANG=en_US.UTF-8

# Local, gitignored settings: .env.local (SANGEET_BUNDLE_ID, APPLE_TEAM), .env.device (APPLE_TEAM, IOS_DEVICE, TV_SERIAL).
[ -f "$REPO/.env.local" ] && set -a && . "$REPO/.env.local" && set +a
[ -f "$REPO/.env.device" ] && set -a && . "$REPO/.env.device" && set +a
SANGEET_BUNDLE_ID="${SANGEET_BUNDLE_ID:-com.example.sangeet}"; export SANGEET_BUNDLE_ID
[ "$SANGEET_BUNDLE_ID" != com.example.sangeet ] || echo "warning: SANGEET_BUNDLE_ID is unset (using com.example.sangeet). Copy .env.local.example to .env.local." >&2

mkdir -p "$ROOT"
if [ ! -d "$W/.git" ] && [ ! -f "$W/.git" ]; then
  git -C "$REPO" worktree add --detach "$W" "$REF"
fi
cd "$W"
git checkout -q -f --detach "$(git -C "$REPO" rev-parse "$REF")"  # -f: npm may rewrite the lockfile here
echo "building $PLATFORM at $(git log --oneline -1)"

stamp() { cat package-lock.json | shasum | cut -c1-16; }
native() {
  { cat package-lock.json app.config.ts; find plugins patches -type f 2>/dev/null | sort | xargs cat 2>/dev/null;
    find modules -type f \( -path "*/ios/*" -o -path "*/android/*" -o -name "expo-module.config.json" -o -name "plugin*" -o -name "app.plugin.js" \) \
      -not -path "*/build/*" -not -path "*/.gradle/*" | sort | xargs cat 2>/dev/null; echo "$PLATFORM ${SANGEET_FREE_TEAM:-} ${APPLE_TEAM:-} $SANGEET_BUNDLE_ID"; } | shasum | cut -c1-16
}

if [ "$(cat .stamp-npm 2>/dev/null)" != "$(stamp)" ] || [ ! -d node_modules ]; then
  S=$(stamp); echo "npm install (lockfile changed)"; npm install --no-audit --no-fund >npm.log 2>&1
  git checkout -q -- package-lock.json; echo "$S" > .stamp-npm
fi

T0=$SECONDS
if [ "$PLATFORM" = tv ]; then
  for f in android-keystore/sangeet-release.jks .env.android; do
    [ -f "$f" ] || { mkdir -p "$(dirname "$f")"; cp "$REPO/$f" "$f"; }
  done
  if [ "$(cat .stamp-native-tv 2>/dev/null)" != "$(native)" ] || [ ! -d android ]; then
    echo "native inputs changed: expo prebuild (incremental)"; SKIP_PREBUILD=0
  else SKIP_PREBUILD=1; fi
  SKIP_PREBUILD=$SKIP_PREBUILD scripts/android-tv-release.sh >build.log 2>&1 || { tail -30 build.log; exit 1; }
  native > .stamp-native-tv
  mkdir -p "$REPO/dist" && cp dist/sangeet-tv.apk "$REPO/dist/sangeet-tv.apk"
  echo "APK ready in $((SECONDS - T0)) s: $REPO/dist/sangeet-tv.apk"
  if [ "${INSTALL:-0}" = 1 ]; then
    ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
    "$ADB" -s "${TV_SERIAL:?set TV_SERIAL}" install -r dist/sangeet-tv.apk
    "$ADB" -s "$TV_SERIAL" shell appops set "$SANGEET_BUNDLE_ID" SYSTEM_ALERT_WINDOW allow
  fi
elif [ "$PLATFORM" = ios ]; then
  export SANGEET_FREE_TEAM="${SANGEET_FREE_TEAM:-1}" SANGEET_APPLE_TEAM="${APPLE_TEAM:-}"
  if [ "$(cat .stamp-native-ios 2>/dev/null)" != "$(native)" ] || [ ! -d ios ]; then
    echo "native inputs changed: expo prebuild (incremental)"; npx expo prebuild -p ios >prebuild.log 2>&1 || { tail -30 prebuild.log; exit 1; }
  fi
  native > .stamp-native-ios
  xcodebuild -workspace ios/Sangeet.xcworkspace -scheme Sangeet -configuration Release -destination generic/platform=iOS \
    -derivedDataPath build -allowProvisioningUpdates >xcode.log 2>&1 \
    || { grep -E "error:|BUILD FAILED" xcode.log | tail -20; exit 1; }
  APP="$W/build/Build/Products/Release-iphoneos/Sangeet.app"
  echo "app ready in $((SECONDS - T0)) s: $APP"
  if [ "${INSTALL:-0}" = 1 ]; then
    for i in 1 2 3 4 5 6; do xcrun devicectl device install app --device "${IOS_DEVICE:?set IOS_DEVICE}" "$APP" >install.log 2>&1 && { echo installed; break; }; sleep 10; done
    xcrun devicectl device process launch --device "$IOS_DEVICE" "$SANGEET_BUNDLE_ID" >/dev/null 2>&1 || true
  fi
else
  echo "unknown platform $PLATFORM"; exit 2
fi
