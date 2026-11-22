import { appendLog, formatLine, type LogLevel } from './logFile';
import { redact } from './redact';

const t0 = Date.now();

function stamp(): string {
  return `${new Date().toISOString().slice(11, 23)} +${((Date.now() - t0) / 1000).toFixed(2)}s`;
}

function render(args: unknown[]): string {
  return redact(
    args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.message;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' '),
  );
}

function emit(level: LogLevel, tag: string, args: unknown[]): void {
  const msg = render(args);
  (level === 'I' ? console.log : level === 'W' ? console.warn : console.error)(`${stamp()} [${tag}]`, msg);
  appendLog(formatLine(level, tag, msg));
}

/** Timestamped logger. Every line is `[tag] message` so simulator logs stay greppable. Secrets are redacted, lines also go to a rotating file. */
export function log(tag: string, ...args: unknown[]): void {
  emit('I', tag, args);
}

export function logWarn(tag: string, ...args: unknown[]): void {
  emit('W', tag, args);
}

export function logError(tag: string, ...args: unknown[]): void {
  emit('E', tag, args);
}

/** Runs `fn` and logs how long it took, whether it resolves or rejects. */
export async function timed<T>(tag: string, step: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    log(tag, `${step} ok in ${Date.now() - start}ms`);
    return result;
  } catch (e) {
    logWarn(tag, `${step} FAILED in ${Date.now() - start}ms:`, e instanceof Error ? e.message : e);
    throw e;
  }
}
