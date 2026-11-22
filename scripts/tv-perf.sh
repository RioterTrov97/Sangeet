#!/usr/bin/env bash
# Runs perf scenarios on a real (or emulated) TV against a RELEASE build and prints one table row per scenario.
#   scripts/tv-perf.sh <scenario|all> [label]      TV_SERIAL from .env.device, or ADB_SERIAL=emulator-5554
# Scenarios: cold home-scroll search-open search-scroll search-type library-history now-layouts rail-toggle rail-idle
#            playing-home playing-after-now (keys only once playing; LAYOUT=music|video|videoLyrics, PLAYWAIT=seconds)
#            A deep link delivered while playing pauses the activity; builds before the 500 ms background debounce paused the music on it.
# The app must be a build with perf mode (sangeet://perf?on=1); the script switches it on. Results are appended to
# dist/tv-perf-<label>.txt. Nothing is uninstalled or changed on the device apart from the app's own state (it plays
# nothing by itself; now-layouts changes the remembered Now Playing layout and puts it back).
# Metrics: gfxinfo frames (total, janky %, p50/p90/p99, slow UI thread), JS thread CPU (mqt_v_js, /proc ticks), PSS and
# graphics memory (meminfo), and from logcat: JS stalls >= 50 ms, API calls, [perf] marks, focus events.
set -uo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
[ -f "$REPO/.env.local" ] && set -a && . "$REPO/.env.local" && set +a
[ -f .env.device ] && set -a && . ./.env.device && set +a
SANGEET_BUNDLE_ID="${SANGEET_BUNDLE_ID:-com.example.sangeet}"; export SANGEET_BUNDLE_ID
[ "$SANGEET_BUNDLE_ID" != com.example.sangeet ] || echo "warning: SANGEET_BUNDLE_ID is unset (using com.example.sangeet). Copy .env.local.example to .env.local." >&2
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
S="${ADB_SERIAL:-${TV_SERIAL:?set TV_SERIAL or ADB_SERIAL}}"
PKG="$SANGEET_BUNDLE_ID"
LABEL="${2:-run}"
OUT="dist/tv-perf-$LABEL.txt"
mkdir -p dist
a() { "$ADB" -s "$S" "$@"; }
sh() { a shell "$@"; }
key() { sh input keyevent "$@"; }
link() { sh am start -a android.intent.action.VIEW -d "'$1'" "$PKG" >/dev/null 2>&1; }
pid() { sh pidof "$PKG" | tr -d '\r'; }
# Presses a key N times with a pause (default 0.5 s) so the app, not adb, sets the pace.
presses() { local k=$1 n=$2 gap=${3:-0.5}; for _ in $(seq "$n"); do key "$k" >/dev/null; sleep "$gap"; done; }
jscpu() { # cumulative JS thread ticks (utime+stime)
  local p; p=$(pid); [ -z "$p" ] && { echo 0; return; }
  sh "for t in /proc/$p/task/*; do if [ \"\$(cat \$t/comm 2>/dev/null)\" = mqt_v_js ]; then cut -d' ' -f14,15 \$t/stat; fi; done" | tr -d '\r' | awk '{s+=$1+$2} END{print s+0}'
}
begin() { sh input keyevent KEYCODE_WAKEUP; a logcat -c; sh dumpsys gfxinfo "$PKG" reset >/dev/null; CPU0=$(jscpu); T0=$(date +%s); }
finish() { # $1 = scenario name
  local name=$1 secs=$(( $(date +%s) - T0 )) cpu1; cpu1=$(jscpu)
  sh dumpsys gfxinfo "$PKG" > /tmp/.tvperf.gfx 2>/dev/null
  sh dumpsys meminfo "$PKG" > /tmp/.tvperf.mem 2>/dev/null
  a logcat -d -v time -s ReactNativeJS:V > /tmp/.tvperf.log 2>/dev/null
  python3 -I - "$name" "$secs" "$CPU0" "$cpu1" <<'PY' | tee -a "$OUT"
import re,sys
name,secs,c0,c1=sys.argv[1],int(sys.argv[2]) or 1,int(sys.argv[3]),int(sys.argv[4])
g=open('/tmp/.tvperf.gfx',errors='ignore').read(); m=open('/tmp/.tvperf.mem',errors='ignore').read(); l=open('/tmp/.tvperf.log',errors='ignore').read()
def f(p,s,d='-'):
    x=re.search(p,s); return x.group(1) if x else d
tot=f(r'Total frames rendered: (\d+)',g); jk=f(r'Janky frames: \d+ \(([\d.]+)%\)',g)
pc=[f(r'%dth percentile: (\d+)ms'%p,g) for p in (50,90,99)]; slow=f(r'Number Slow UI thread: (\d+)',g)
pss=f(r'TOTAL PSS:\s+(\d+)',m) if 'TOTAL PSS' in m else f(r'TOTAL\s+(\d+)',m); gfx=f(r'Graphics:\s+(\d+)',m)
st=[int(x) for x in re.findall(r'\[perf\] stall (\d+)ms',l)]
api=[int(x) for x in re.findall(r"\[api\]'?,?\s*'[^\n]*? ok in (\d+)ms",l)]
marks=re.findall(r'\[perf\] ((?:nav|tab|search|launch):[^\n]*?\d+ms)',l)
foc=len(re.findall(r'\[focus\] rail:',l)); fc=len(re.findall(r'\[focus\] content:',l))
cpu=(c1-c0)/secs  # ticks are 1/100 s, so ticks/s == percent of one core
print(f"{name:16} frames={tot} janky={jk}% p50/90/99={'/'.join(pc)}ms slowUI={slow} | jsCPU={cpu:.0f}% | stalls={len(st)} ({sum(st)}ms, max {max(st or [0])}) | api={len(api)} (avg {sum(api)//max(1,len(api))}ms max {max(api or [0])}) | PSS={int(pss)//1024 if pss!='-' else '-'}MB gfx={int(gfx)//1024 if gfx!='-' else '-'}MB | focus rail={foc} content={fc}")
for x in marks[:8]: print('    mark', x)
PY
}
nav() { link "sangeet://dev?cmd=nav&a=$1"; sleep "${2:-2}"; }

scen_cold() { sh am force-stop "$PKG"; sleep 2; link "sangeet://perf?on=1"; sleep 5; sh am force-stop "$PKG"; sleep 2; begin
  sh am start -W -n "$PKG/.MainActivity" -c android.intent.category.LEANBACK_LAUNCHER -a android.intent.action.MAIN | grep -E "TotalTime|WaitTime" | tr '\n' ' ' | tee -a "$OUT"; echo | tee -a "$OUT"
  sleep 15; finish cold; }
# Cold start, then play one song through the driver: prints the resolver's own timings (steps include innertube, potoken, player).
scen_firstplay() { sh am force-stop "$PKG"; sleep 2; link "sangeet://perf?on=1"; sleep 4; sh am force-stop "$PKG"; sleep 2; a logcat -c
  sh am start -W -n "$PKG/.MainActivity" -c android.intent.category.LEANBACK_LAUNCHER -a android.intent.action.MAIN >/dev/null; sleep 10
  local t0; t0=$(date +%s); link "sangeet://dev?cmd=play&a=${PLAY_ID:-60ItHLz5WEA}"; sleep 20
  a logcat -d -v time -s ReactNativeJS:V | grep -E "step (innertube|potoken|player|mint)|potoken:|resolver.*(extract|resolved|client=)|first stream" | sed 's/^/    /' | tee -a "$OUT"; }
scen_home-scroll() { nav home 3; begin; presses KEYCODE_DPAD_DOWN 8; presses KEYCODE_DPAD_UP 4; presses KEYCODE_DPAD_RIGHT 6 0.4; finish home-scroll; }
scen_search-open() { nav home 2; begin; nav search 10; finish search-open; }
scen_search-scroll() { nav search 4; begin; presses KEYCODE_DPAD_DOWN 14 0.5; presses KEYCODE_DPAD_RIGHT 4 0.4; presses KEYCODE_DPAD_UP 6 0.5; finish search-scroll; }
scen_search-type() { nav search 3; begin; link "sangeet://dev?cmd=type&a=adele"; sleep 12; presses KEYCODE_DPAD_DOWN 6 0.6; finish search-type; }
scen_library-history() { nav library 3; begin; presses KEYCODE_DPAD_RIGHT 4 0.5; sleep 3; presses KEYCODE_DPAD_DOWN 10 0.5; finish library-history; }
scen_now-layouts() { local orig
  link "sangeet://dev?cmd=layout"; sleep 2; orig=$(a logcat -d -s ReactNativeJS:V | grep -o 'layout was [A-Za-z]*' | tail -1 | cut -d' ' -f3); orig=${orig:-music}
  begin; nav now 3
  for l in music musicLyrics lyrics video videoLyrics videoLyricsOverlay; do link "sangeet://dev?cmd=layout&a=$l"; sleep 4; done
  finish now-layouts; link "sangeet://dev?cmd=layout&a=$orig"; sleep 2; nav home 1; echo "(layout restored to $orig)"; }
scen_rail-toggle() { nav home 3; key KEYCODE_DPAD_DOWN >/dev/null; sleep 1; begin; for _ in $(seq 10); do key KEYCODE_DPAD_LEFT >/dev/null; sleep 0.8; key KEYCODE_DPAD_RIGHT >/dev/null; sleep 0.8; done; finish rail-toggle; }
scen_rail-idle() { nav home 3; begin; sleep "${IDLE:-60}"; finish rail-idle; }

# Keys-only "while playing" scenarios. The queue must already be loaded (the TV restores the last one at launch).
play_keys() { key KEYCODE_MEDIA_PLAY; sleep 4; }
# Home Spotlight: focus starts on Pause/Play, Right is "Open player" (a push, so Home stays mounted underneath; the rail would replace the stack).
open_now_by_button() { sleep 6; key KEYCODE_DPAD_RIGHT >/dev/null; sleep 0.7; key KEYCODE_DPAD_CENTER >/dev/null; }
# Home while music plays and Now Playing was never opened: steady state 14 s after the song started (frames, JS CPU).
scen_playing-home() { nav home 3; play_keys; sleep 10; begin; sleep 6; finish playing-home; }
# Open Now Playing in $LAYOUT while playing, stay PLAYWAIT s, wake the controls, Back x2; measure the first 8 s on Home, then 12 D-pad moves.
scen_playing-after-now() { link "sangeet://dev?cmd=layout&a=${LAYOUT:-video}"; sleep 1; nav home 3; play_keys
  open_now_by_button; sleep "${PLAYWAIT:-25}"; key KEYCODE_DPAD_LEFT >/dev/null; sleep 1.5; begin; key KEYCODE_BACK >/dev/null; sleep 0.7; key KEYCODE_BACK >/dev/null; sleep 8
  finish playing-after-now
  begin; presses KEYCODE_DPAD_DOWN 4; presses KEYCODE_DPAD_UP 4; presses KEYCODE_DPAD_DOWN 2; presses KEYCODE_DPAD_UP 2; finish playing-dpad; }

link "sangeet://perf?on=1"; sleep 1
if [ "${1:-all}" = all ]; then for sc in cold home-scroll search-open search-scroll search-type library-history now-layouts rail-toggle rail-idle; do "scen_$sc"; done
else "scen_$1"; fi
