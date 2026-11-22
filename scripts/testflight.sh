#!/usr/bin/env bash
# Build a committed ref and upload it to TestFlight (internal testing), and drive the rest of the release flow.
#   scripts/testflight.sh [ref]                 = beta: gates, build, upload, What to Test, local tag (default ref: main)
#   scripts/testflight.sh beta|build|metadata|screenshots|release-prep [ref]
#   scripts/testflight.sh certs                 one-time: create/fetch the App Store signing certificate and profile with fastlane match
#     beta          gates (SKIP_GATES=1 skips, loudly) + build + upload + tag testflight/<version>-<build>
#     build         build the IPA only (checks signing); also DRY_RUN=1 scripts/testflight.sh
#     metadata      push the listing from fastlane/metadata to App Store Connect (never submits); WITH_SCREENSHOTS=1 adds screenshots
#     screenshots   capture fastlane/screenshots/${SANGEET_LISTING_LOCALE:-en-AU} on the simulator (no Apple account needed)
#     release-prep  screenshots, then metadata with those screenshots
#     certs         runs the `certs` lane from this checkout (needs MATCH_GIT_URL, MATCH_PASSWORD, the API key); see docs/INSTALL.md
#   Review submission is manual: bundle exec fastlane ios submit_review (see docs/INSTALL.md).
#   A ref that is not an ancestor of main is refused unless ALLOW_ANY_REF=1.
#   SANGEET_CARPLAY=1 includes the CarPlay entitlement (needs Apple approval first).
# Settings: git-ignored .env.local (SANGEET_BUNDLE_ID, APPLE_TEAM) and .env.testflight (see .env.testflight.example). Same warm-worktree approach as device-build.sh,
# in its own worktree (~/Library/Caches/sangeet-builds/testflight). Builds committed code only; the gates run in that worktree.
set -euo pipefail
CMD=beta
case "${1:-}" in beta|build|metadata|screenshots|release-prep|certs) CMD="$1"; shift ;; esac
REF="${1:-main}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${SANGEET_BUILD_ROOT:-$HOME/Library/Caches/sangeet-builds}"
W="$ROOT/testflight"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

[ -f "$REPO/.env.local" ] && set -a && . "$REPO/.env.local" && set +a
[ -f "$REPO/.env.testflight" ] && set -a && . "$REPO/.env.testflight" && set +a

# Only ship what is on main (a branch's WIP or a detached experiment must be opted in).
git -C "$REPO" rev-parse --verify -q "$REF^{commit}" >/dev/null || { echo "error: unknown ref $REF" >&2; exit 1; }
if [ "${ALLOW_ANY_REF:-0}" != 1 ] && ! git -C "$REPO" merge-base --is-ancestor "$REF" main; then
  echo "error: $REF is not an ancestor of main. Merge it first, or set ALLOW_ANY_REF=1." >&2
  exit 1
fi

# Identity: the real bundle ID is required for anything that talks to Apple.
if [ "$CMD" != screenshots ] && { [ -z "${SANGEET_BUNDLE_ID:-}" ] || [ "$SANGEET_BUNDLE_ID" = com.example.sangeet ]; }; then
  echo "error: SANGEET_BUNDLE_ID is unset or still the example value. Set your bundle ID in .env.local (see .env.local.example)." >&2
  exit 1
fi
export SANGEET_BUNDLE_ID

if [ "$CMD" = screenshots ]; then exec "$REPO/scripts/screenshots.sh" "$REF"; fi
if [ "$CMD" = release-prep ]; then
  "$REPO/scripts/screenshots.sh" "$REF"
  CMD=metadata; export WITH_SCREENSHOTS=1
fi
# The listing text comes from the committed ref; screenshots come from the main checkout (what screenshots.sh just wrote).
export SCREENSHOTS_PATH="$REPO/fastlane/screenshots"

missing=""
if [ "$CMD" = metadata ]; then need="ASC_KEY_ID ASC_ISSUER_ID"; else need="APPLE_TEAM ASC_KEY_ID ASC_ISSUER_ID MATCH_GIT_URL MATCH_PASSWORD"; fi
for v in $need; do [ -n "${!v:-}" ] || missing="$missing $v"; done
[ -n "${ASC_KEY_PATH:-}" ] || [ -n "${ASC_KEY_CONTENT:-}" ] || missing="$missing ASC_KEY_PATH(or ASC_KEY_CONTENT)"
if [ -n "$missing" ]; then
  echo "error: missing$missing. Copy .env.testflight.example to .env.testflight and fill it in (see docs/INSTALL.md, TestFlight)." >&2
  exit 1
fi
if [ -n "${ASC_KEY_PATH:-}" ] && [ ! -f "$ASC_KEY_PATH" ]; then echo "error: ASC_KEY_PATH not found: $ASC_KEY_PATH" >&2; exit 1; fi

# Gems live in the main checkout's vendor/bundle; fastlane runs from the worktree.
export BUNDLE_GEMFILE="$REPO/Gemfile" BUNDLE_PATH="$REPO/vendor/bundle"
bundle check >/dev/null 2>&1 || bundle install >/dev/null

if [ "$CMD" = certs ]; then
  # One-time signing setup; needs fastlane/ but no build, so run it here.
  cd "$REPO"
  bundle exec fastlane ios certs
  exit $?
fi

if [ "$CMD" = metadata ]; then
  # No build needed: just the listing files from the exact commit.
  mkdir -p "$ROOT"
  if [ ! -d "$W/.git" ] && [ ! -f "$W/.git" ]; then git -C "$REPO" worktree add --detach "$W" "$REF"; fi
  cd "$W"; git checkout -q -f --detach "$(git -C "$REPO" rev-parse "$REF")"
  [ "${WITH_SCREENSHOTS:-0}" = 1 ] && ! ls "$SCREENSHOTS_PATH"/${SANGEET_LISTING_LOCALE:-en-AU}/*.png >/dev/null 2>&1 && { echo "error: no screenshots in $SCREENSHOTS_PATH/${SANGEET_LISTING_LOCALE:-en-AU} (run: scripts/testflight.sh screenshots)" >&2; exit 1; }
  echo "pushing listing from $(git log --oneline -1) (nothing is submitted for review)"
  bundle exec fastlane ios metadata 2>&1 | tee metadata.log | grep -E "\[!\]|error|Successfully|Finished" | tail -20
  exit "${PIPESTATUS[0]}"
fi

mkdir -p "$ROOT"
if [ ! -d "$W/.git" ] && [ ! -f "$W/.git" ]; then
  git -C "$REPO" worktree add --detach "$W" "$REF"
fi
cd "$W"
git checkout -q -f --detach "$(git -C "$REPO" rev-parse "$REF")"
echo "building testflight at $(git log --oneline -1)"

# Release signing: no free-team mode, CarPlay off unless asked.
export SANGEET_FREE_TEAM=0 SANGEET_APPLE_TEAM="$APPLE_TEAM" SANGEET_CARPLAY="${SANGEET_CARPLAY:-0}"

stamp() { cat package-lock.json | shasum | cut -c1-16; }
native() {
  { cat package-lock.json app.config.ts; find plugins patches -type f 2>/dev/null | sort | xargs cat 2>/dev/null;
    find modules -type f \( -path "*/ios/*" -o -path "*/android/*" -o -name "expo-module.config.json" -o -name "plugin*" -o -name "app.plugin.js" \) \
      -not -path "*/build/*" -not -path "*/.gradle/*" | sort | xargs cat 2>/dev/null
    echo "testflight $SANGEET_FREE_TEAM $SANGEET_CARPLAY $APPLE_TEAM $SANGEET_BUNDLE_ID"; } | shasum | cut -c1-16
}

if [ "$(cat .stamp-npm 2>/dev/null)" != "$(stamp)" ] || [ ! -d node_modules ]; then
  S=$(stamp); echo "npm install (lockfile changed)"; npm install --no-audit --no-fund >npm.log 2>&1
  git checkout -q -- package-lock.json; echo "$S" > .stamp-npm
fi

T0=$SECONDS
if [ "$(cat .stamp-native-testflight 2>/dev/null)" != "$(native)" ] || [ ! -d ios ]; then
  echo "native inputs changed: expo prebuild (incremental)"
  npx expo prebuild -p ios >prebuild.log 2>&1 || { tail -30 prebuild.log; exit 1; }
fi
native > .stamp-native-testflight

LANE=beta; { [ "${DRY_RUN:-0}" = 1 ] || [ "$CMD" = build ]; } && LANE=build_only
[ "$LANE" = beta ] && [ "${SKIP_GATES:-0}" = 1 ] && echo "WARNING: SKIP_GATES=1, shipping without tsc, eslint and jest" >&2
[ "$LANE" = beta ] && echo "beta: gates, build, upload, then waiting (up to 1 h) for Apple to process the build so What to Test can be set"
rm -f build-number.txt
bundle exec fastlane ios "$LANE" >fastlane.log 2>&1 \
  || { grep -E "error|\[!\]|failed|Gates" fastlane.log | tail -20; echo "full log: $W/fastlane.log" >&2; exit 1; }
echo "build ${LANE} done in $((SECONDS - T0)) s: version/build $(cat build-number.txt 2>/dev/null)"
echo "IPA: $W/build/testflight/Sangeet.ipa"
if [ "$LANE" = beta ]; then echo "uploaded to TestFlight with What to Test (build/testflight/changelog.txt); tagged testflight/$(cat build-number.txt | sed 's/ (/-/; s/)//') locally, not pushed"; fi
