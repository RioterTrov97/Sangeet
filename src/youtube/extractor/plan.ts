/**
 * Pure decisions for the extractor page (src/youtube/extractor/page.ts, which runs in a WebView and cannot be unit tested).
 * Idea as in yt-dlp's lazy `fetch_po_token_func`: work that only some clients need is done right before the first such client.
 */

/** Clients whose googlevideo URLs take the GVS PO token (`pot`). */
export const NEEDS_GVS_POT: ReadonlySet<string> = new Set(['MWEB', 'WEB', 'WEB_EMBEDDED']);
/** Clients whose player response / URLs need the JS player (signatureTimestamp, signature and `n` deciphering). VISIONOS URLs are plain. */
export const NEEDS_PLAYER: ReadonlySet<string> = new Set(['TV', 'MWEB', 'WEB', 'WEB_EMBEDDED']);

export const needsGvsPot = (client: string): boolean => NEEDS_GVS_POT.has(client);
export const needsPlayer = (client: string): boolean => NEEDS_PLAYER.has(client);
/** A format with a signature cipher cannot be used without the player whatever the client. */
export const formatNeedsPlayer = (client: string, f: { signature_cipher?: unknown; cipher?: unknown }): boolean =>
  needsPlayer(client) || !!f.signature_cipher || !!f.cipher;

/** Whether any client of the ordered list needs a PO token (the minter is never created when this is false). */
export const anyNeedsPot = (clients: readonly string[]): boolean => clients.some(needsGvsPot);

/** Memoises an async factory; a failure clears the memo so the next call retries (like the session promise). */
export function lazyOnce<T>(fn: () => Promise<T>): { get: () => Promise<T>; started: () => boolean } {
  let p: Promise<T> | undefined;
  return {
    get: () => {
      p ??= fn().catch((e) => {
        p = undefined;
        throw e;
      });
      return p;
    },
    started: () => p !== undefined,
  };
}

/** Memoises an async factory per key (e.g. content token per videoId); failures are not kept. */
export function lazyByKey<K, T>(fn: (key: K) => Promise<T>): (key: K) => Promise<T> {
  const m = new Map<K, Promise<T>>();
  return (key) => {
    let p = m.get(key);
    if (!p) {
      p = fn(key).catch((e) => {
        m.delete(key);
        throw e;
      });
      m.set(key, p);
    }
    return p;
  };
}
