export type ResolvedStream = {
  /** Upstream (googlevideo) URL. */
  url: string;
  mimeType: string;
  contentLength: number;
  /** Epoch ms. */
  expiresAt: number;
  itag: number;
  initRange?: { start: number; end: number };
  indexRange?: { start: number; end: number };
  userAgent?: string;
  /** Extra upstream request headers (the backup server's bearer token). */
  headers?: Record<string, string>;
  /** Which source produced this stream, for logs and diagnostics. */
  source?: string;
  client?: string;
  /** On-device clients that failed before this one succeeded. */
  failed?: { client: string; error?: string }[];
  codecs?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  durationMs?: number;
};

export interface StreamResolver {
  resolve(videoId: string, opts?: { fresh?: boolean; clients?: string[]; /** Last resort: smallest audio / 360p video. */ lowQuality?: boolean }): Promise<ResolvedStream>;
}
