# Sangeet backup server

A tiny personal server the Sangeet app falls back to when its on-device YouTube resolver breaks (YouTube changes happen).
Python + FastAPI + yt-dlp. It is yours alone: everything needs `Authorization: Bearer <token>`.

| Endpoint | What |
| --- | --- |
| `GET /health` | `{status, ytdlp}` (used by the app's "Test connection") |
| `GET /resolve/{videoId}?kind=audio\|video` | `{url, mimeType, contentLength, expiresAt, itag, initRange, indexRange}`. Audio is AAC/m4a (itag 140); video is progressive avc1+aac mp4. Cached until expiry. |
| `GET /stream/{videoId}[?kind=video]` | Range-supporting proxy of the media. **The app uses this**, because YouTube URLs are usually bound to the IP that resolved them (the server's, not your phone's). |

The token comes from `SANGEET_TOKEN`, else `data/token`, else it is generated on first run, saved (mode 0600) and printed once.

## Run it (any of these takes about 5 minutes)

### A. Your Mac (no Docker)
```sh
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app_factory --factory --host 0.0.0.0 --port 8000
```
Note the token printed on first start. Keep it running with `launchd` or `tmux`. With [uv](https://docs.astral.sh/uv/): `uv run --with-requirements requirements.txt uvicorn app.main:app_factory --factory --host 0.0.0.0`.

### B. Raspberry Pi (64-bit OS)
```sh
sudo apt install -y docker.io docker-compose-plugin   # or use option A with python3-venv
git clone <this repo> && cd Sangeet/server
docker compose up -d --build
docker compose logs sangeet-server | grep -A1 token    # first run prints the token once
```

### C. Oracle Cloud Always Free (ARM VM, Ubuntu)
Create an Always Free `VM.Standard.A1.Flex` instance, SSH in, then follow B. Do **not** open port 8000 in the cloud firewall: reach it over Tailscale only (below). Note: datacenter IPs are sometimes blocked by YouTube, a Pi or your Mac at home is more reliable.

## Reach it with Tailscale (recommended)
1. Install [Tailscale](https://tailscale.com) on the server machine and on your iPhone, sign in to the same tailnet.
2. Name the machine `sangeet-server` (admin console, or `sudo tailscale set --hostname sangeet-server`). MagicDNS gives it `http://sangeet-server:8000`.
3. In Sangeet: Settings > Backup server > URL `http://sangeet-server:8000`, paste the token, tap "Test connection".

Traffic stays inside your tailnet (WireGuard-encrypted), so plain `http://` is fine. The app allows local-network HTTP.

## Age-restricted videos (optional, sensitive)
Export `cookies.txt` (Netscape format) from a browser you are signed in to, and put it at `data/cookies.txt` (or mount it, see `compose.yaml`). **That file is a login to your Google account: keep it out of git (it is gitignored), `chmod 600` it, never share it.** Skip this unless you need it.

## Keep yt-dlp fresh
YouTube breaks extractors often; upgrade nightly. The version is pinned in `requirements.txt` for reproducible builds, the upgrade script bypasses the pin.

**Venv install (cron):** `crontab -e`
```
17 4 * * * /path/to/Sangeet/server/sangeet-ytdlp-upgrade.sh >> /tmp/sangeet-ytdlp.log 2>&1 && pkill -f "uvicorn app.main" ; true
```
(then let launchd/systemd restart uvicorn; or just restart it yourself.)

**systemd timer (Pi/Linux):**
```ini
# /etc/systemd/system/sangeet-ytdlp.service
[Service]
Type=oneshot
ExecStart=/path/to/Sangeet/server/sangeet-ytdlp-upgrade.sh
ExecStartPost=/bin/systemctl restart sangeet-server
# /etc/systemd/system/sangeet-ytdlp.timer
[Timer]
OnCalendar=*-*-* 04:17:00
Persistent=true
[Install]
WantedBy=timers.target
```
`sudo systemctl enable --now sangeet-ytdlp.timer`

**Docker:** `docker compose build --pull --no-cache && docker compose up -d` after editing the pin in `requirements.txt` (or run `docker compose exec sangeet-server pip install -U yt-dlp && docker compose restart` for a quick bump), e.g. from a nightly cron.

## Tests
```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/pytest
```
yt-dlp and the upstream HTTP calls are mocked; nothing touches YouTube.
