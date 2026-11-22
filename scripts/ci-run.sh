#!/usr/bin/env bash
# Runs one CI step with its output kept off the public Actions log.
#   scripts/ci-run.sh <name> <command...>
# Full output goes to $CI_LOG_DIR/<name>.log (the Release workflow encrypts that folder; see docs/INSTALL.md).
# The public log gets only lines matching CI_SHOW (default: fastlane's summary lines), and on failure the last error
# lines. Both pass through the scrubber first: emails, device UDIDs and long hex tokens are replaced.
set -uo pipefail
name="$1"; shift
dir="${CI_LOG_DIR:-${RUNNER_TEMP:-/tmp}/ci-logs}"
mkdir -p "$dir"
log="$dir/$name.log"
show="${CI_SHOW:-^\[[0-9:]+\]: (Version|Release notes|Uploaded|Tagged|Gates passed|Successfully)}"

scrub() {
  perl -pe '
    s/\e\[[0-9;]*m//g;
    s/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<email>/g;
    s/\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}\b/<udid>/g;
    s/\b[0-9A-Fa-f]{40}\b/<hex40>/g;
    s/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/<jwt>/g;
    s/\+?\d[\d ()-]{8,}\d/<number>/g if /phone|tel/i;
  '
}

start=$SECONDS
"$@" >"$log" 2>&1
status=$?
took=$((SECONDS - start))

grep -E "$show" "$log" | scrub | tail -15 || true
if [ "$status" != 0 ]; then
  echo "::group::$name failed: last error lines (scrubbed; full log is in the encrypted logs artifact)"
  errors=$(grep -E -i "\[!\]|error|failed|exception|what went wrong" "$log" | tail -30)
  if [ -n "$errors" ]; then printf '%s\n' "$errors" | scrub; else tail -30 "$log" | scrub; fi
  echo "::endgroup::"
  echo "::error::$name failed after ${took}s"
  exit "$status"
fi
echo "$name: done in ${took}s"
