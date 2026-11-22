/** Wire format between React Native and the hidden extractor WebView. */
export type BridgeRequest = { id: number; method: string; params?: unknown };

export type BridgeResponse =
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: string };

export type BridgeLog = { type: 'log'; message: string };
export type BridgeReady = { type: 'ready' };

export type PageMessage = BridgeResponse | BridgeLog | BridgeReady;

export type StreamInfo = {
  url: string;
  mimeType: string;
  contentLength: number;
  expiresAt: number; // epoch ms
  itag: number;
  /** DASH init segment and sidx byte ranges (inclusive). */
  initRange?: { start: number; end: number };
  indexRange?: { start: number; end: number };
  /** Video streams only. */
  codecs?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  /** approx_duration_ms of the format (DASH manifest). */
  durationMs?: number;
  client: string;
  userAgent: string;
  timings: Record<string, number>;
  /** Clients that failed before this one succeeded. */
  /** Audio only: itag 141 (higher-bitrate AAC) is offered. */
  hasHigh?: boolean;
  failed?: { client: string; error?: string }[];
};
