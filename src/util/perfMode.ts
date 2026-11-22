import { storage } from './storage';

/**
 * Opt-in profiling mode for real devices (release builds too). Off by default; while off, everything here is one boolean
 * read. Switch it with `sangeet://perf?on=1` (persisted, so a relaunch keeps it) and `sangeet://perf?on=0`.
 * While on: JS-thread stalls (a 50 ms timer that arrives late) are logged with the active screen as `[perf] stall`, focus
 * moves as `[focus] rail:Search` / `[focus] content:Play`, and `sangeet://dev?cmd=...` drives the TV app (see perfDriver.ts).
 */
const KEY = 'perf.on';
const STALL_MS = 50;
const TICK_MS = 50;

let on = false;
try {
  on = storage.getBoolean(KEY) ?? false;
} catch {
  on = false;
}
let screen = 'boot';
let timer: ReturnType<typeof setInterval> | undefined;
let stalls = 0;
let stallMs = 0;

export const perfOn = (): boolean => on;
export const setPerfScreen = (name: string): void => void (screen = name);

function watch(): void {
  if (timer) return;
  let last = Date.now();
  timer = setInterval(() => {
    const now = Date.now();
    const late = now - last - TICK_MS;
    last = now;
    if (late >= STALL_MS) {
      stalls++;
      stallMs += late;
      console.log(`[perf] stall ${late}ms screen=${screen}`);
    }
  }, TICK_MS);
}

export function setPerfOn(v: boolean): void {
  on = v;
  try {
    storage.set(KEY, v);
  } catch {
    /* best effort */
  }
  if (v) watch();
  else if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  console.log(`[perf] mode ${v ? 'on' : 'off'}`);
}

/** Stall totals since the mode was switched on, for the script (`sangeet://dev?cmd=stalls`). */
export const stallTotals = () => ({ stalls, stallMs });

/** Logs where D-pad focus is: `[focus] rail:Search`, `[focus] content:Quick pick title`. Free when the mode is off. */
export function perfFocus(zone: 'rail' | 'content', label: string | undefined): void {
  if (on) console.log(`[focus] ${zone}:${label ?? ''} screen=${screen}`);
}

/** Marks for the script: `[perf] mark <name>` at a point in time. */
export function perfMark(name: string): void {
  if (on) console.log(`[perf] mark ${name}`);
}

if (on) watch();
