#!/bin/sh
# Nightly yt-dlp upgrade. Run from cron/systemd (see README). Works for a venv install; for Docker see README.
set -eu
cd "$(dirname "$0")"
.venv/bin/pip install --quiet --upgrade yt-dlp
.venv/bin/python -c "import yt_dlp.version as v; print('yt-dlp', v.__version__)"
