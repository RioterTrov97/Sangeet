#!/usr/bin/env bash
# Builds the signed Android TV release APK: dist/sangeet-tv.apk
#   scripts/android-tv-release.sh            incremental
#   CLEAN=1 scripts/android-tv-release.sh    regenerate android/ from scratch
#   ABIS=arm64-v8a scripts/android-tv-release.sh   single ABI (default: arm64-v8a,armeabi-v7a)
# First run creates android-keystore/sangeet-release.jks with a random password stored in .env.android (both gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."

export LANG=en_US.UTF-8
# Identity (SANGEET_BUNDLE_ID) from git-ignored .env.local; device-build.sh passes it down from the main checkout.
[ -f .env.local ] && set -a && . ./.env.local && set +a
export JAVA_HOME="${JAVA_HOME:-$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"
# Chromecast with Google TV runs a 32-bit userspace on some builds, so ship both ABIs.
ABIS="${ABIS:-arm64-v8a,armeabi-v7a}"

KEYSTORE=android-keystore/sangeet-release.jks
if [ ! -f "$KEYSTORE" ]; then
  echo "Generating release keystore (password goes to .env.android, never printed)"
  mkdir -p android-keystore
  PASS="$(openssl rand -hex 16)"
  keytool -genkeypair -v -keystore "$KEYSTORE" -alias sangeet -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" -dname "CN=Sangeet, O=Sangeet, C=US" >/dev/null 2>&1
  printf 'SANGEET_KEYSTORE_PASSWORD=%s\nSANGEET_KEY_ALIAS=sangeet\n' "$PASS" > .env.android
  chmod 600 .env.android "$KEYSTORE"
fi

PREBUILD_ARGS=(-p android --no-install)
[ "${CLEAN:-0}" = "1" ] && PREBUILD_ARGS+=(--clean)
# SKIP_PREBUILD=1 (set by device-build.sh when no native input changed) reuses android/ as is.
[ "${SKIP_PREBUILD:-0}" = "1" ] || npx expo prebuild "${PREBUILD_ARGS[@]}"
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# --build-cache: reuse compiled outputs (Kotlin, Java, C++) from earlier builds in ~/.gradle/caches/build-cache-1, which
# the Release workflow keeps between runs. Gradle keys entries by their inputs, so a changed file is always rebuilt.
(cd android && ./gradlew assembleRelease --build-cache -PreactNativeArchitectures="$ABIS")

mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk dist/sangeet-tv.apk
APKSIGNER="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)apksigner"
"$APKSIGNER" verify --print-certs dist/sangeet-tv.apk | head -2 || true
ls -lh dist/sangeet-tv.apk
