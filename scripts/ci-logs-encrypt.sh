#!/usr/bin/env bash
# Packs the CI step logs (scripts/ci-run.sh) into ci-logs-<job>.tar.gz.enc, encrypted with CI_LOG_PASSPHRASE, so the
# full output can be uploaded as an artifact on a public repo. Without the passphrase nothing is written.
# Decrypt: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in ci-logs-<job>.tar.gz.enc -pass env:CI_LOG_PASSPHRASE | tar xz
set -euo pipefail
job="$1"
dir="${CI_LOG_DIR:-${RUNNER_TEMP:-/tmp}/ci-logs}"
if [ -z "${CI_LOG_PASSPHRASE:-}" ]; then
  echo "::notice::CI_LOG_PASSPHRASE is not set: full logs stay on the runner and are discarded."
  exit 0
fi
[ -d "$dir" ] && ls "$dir"/*.log >/dev/null 2>&1 || { echo "no step logs"; exit 0; }
tar -C "$dir" -czf - . | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:CI_LOG_PASSPHRASE -out "ci-logs-$job.tar.gz.enc"
echo "encrypted logs: ci-logs-$job.tar.gz.enc ($(du -h "ci-logs-$job.tar.gz.enc" | cut -f1))"
