import { Directory, File, FileMode, Paths } from 'expo-file-system';

/** Rotating log file: `sangeet.log` (current) plus `.1` and `.2`, each capped near 2 MB. */
export const MAX_BYTES = 2 * 1024 * 1024;
export const FILES = 3;
const enc = new TextEncoder();

export type LogLevel = 'I' | 'W' | 'E';
export type LogEntry = { ts: string; level: LogLevel; tag: string; msg: string; raw: string };

const dir = () => new Directory(Paths.document, 'logs');
const fileAt = (i: number) => new File(dir(), i === 0 ? 'sangeet.log' : `sangeet.log.${i}`);

let buffer: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let size = -1;
let disabled = typeof process !== 'undefined' && !!process.env?.JEST_WORKER_ID;

export function formatLine(level: LogLevel, tag: string, msg: string): string {
  return `${new Date().toISOString()} ${level} [${tag}] ${msg.replace(/\r?\n/g, ' ⏎ ')}\n`;
}

export function parseLine(raw: string): LogEntry | null {
  const m = /^(\S+) ([IWE]) \[([^\]]*)\] (.*)$/.exec(raw);
  return m ? { ts: m[1], level: m[2] as LogLevel, tag: m[3], msg: m[4], raw } : null;
}

function rotate(): void {
  try {
    const last = fileAt(FILES - 1);
    if (last.exists) last.delete();
    for (let i = FILES - 2; i >= 0; i--) {
      const f = fileAt(i);
      if (f.exists) f.move(fileAt(i + 1));
    }
  } catch {
    /* logging must never throw */
  }
  size = 0;
}

function flush(): void {
  timer = undefined;
  if (disabled || buffer.length === 0) return;
  const text = buffer.join('');
  buffer = [];
  try {
    const d = dir();
    if (!d.exists) d.create({ intermediates: true });
    const f = fileAt(0);
    if (!f.exists) f.create();
    if (size < 0) size = f.size ?? 0;
    if (size >= MAX_BYTES) rotate();
    const f0 = fileAt(0);
    if (!f0.exists) f0.create();
    const bytes = enc.encode(text);
    const h = f0.open(FileMode.Append);
    try {
      h.writeBytesSync(bytes);
    } finally {
      h.close();
    }
    size += bytes.length;
  } catch {
    disabled = true; // file system unavailable; keep the console only
  }
}

export function appendLog(line: string): void {
  if (disabled) return;
  buffer.push(line);
  if (buffer.length > 2000) buffer.splice(0, buffer.length - 2000);
  timer ??= setTimeout(flush, 1000);
}

export function flushLogs(): void {
  if (timer) clearTimeout(timer);
  flush();
}

/** All retained lines, oldest first. */
export function readLogLines(): LogEntry[] {
  flushLogs();
  const out: LogEntry[] = [];
  for (let i = FILES - 1; i >= 0; i--) {
    try {
      const f = fileAt(i);
      if (!f.exists) continue;
      for (const raw of f.textSync().split('\n')) {
        const e = raw ? parseLine(raw) : null;
        if (e) out.push(e);
      }
    } catch {
      /* skip unreadable file */
    }
  }
  return out;
}

export function logFileUri(): string | undefined {
  flushLogs();
  const f = fileAt(0);
  return f.exists ? f.uri : undefined;
}

export function clearLogs(): void {
  buffer = [];
  for (let i = 0; i < FILES; i++) {
    try {
      const f = fileAt(i);
      if (f.exists) f.delete();
    } catch {
      /* ignore */
    }
  }
  size = 0;
}
