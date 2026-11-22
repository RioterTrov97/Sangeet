import { requireNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';

export type StreamInfoForProxy = {
  url: string;
  mimeType: string;
  contentLength: number;
  /** Epoch ms. */
  expiresAt: number;
  userAgent?: string;
  /** Extra headers sent upstream (the backup server's bearer token). */
  headers?: Record<string, string>;
  /** DASH init segment / sidx byte ranges (inclusive); needed for the HLS playlist. */
  initStart?: number;
  initEnd?: number;
  indexStart?: number;
  indexEnd?: number;
  /** Video streams only (HLS master playlist). */
  codecs?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  /** Android DASH manifest. */
  durationMs?: number;
};

export type ResolveRequest = { videoId: string; requestId: string; /** True when the proxy got a 403 and the cached URL must not be reused. */ refresh: boolean };

/** Tags of a local audio file; every field is optional (a file AVFoundation cannot read gives only `hasArtwork: false`). */
export type AudioTags = { title?: string; artist?: string; album?: string; durationSec?: number; hasArtwork: boolean };

export type BgDownloadSpec = { url: string; headers?: Record<string, string>; userAgent?: string; total: number; partPath: string; destPath: string };
export type BgDownloadStatus = { id: string; bytes: number; total: number; state: 'running' | 'done' | 'failed'; error?: string; needsResolve?: boolean };

type StreamProxyNative = {
  /** Starts the proxy (idempotent) and resolves with the listening port on 127.0.0.1. */
  start(): Promise<number>;
  /** iOS: drops the listener and binds the same port again (the socket can be gone after the app sat suspended). */
  restart?(): Promise<number>;
  /** Answers a resolve request (requestId set) or primes the proxy's cache (requestId null). */
  fulfill(requestId: string | null, videoId: string, info: StreamInfoForProxy): void;
  reject(requestId: string, reason: string): void;
  /** Android only: decoders per codec family (see DecoderCaps.kt). */
  decoderCaps?(): Record<string, { maxHeight: number; hw: boolean }>;
  unregister(videoId: string): void;
  /** Dev "force offline": the proxy treats every upstream request as failed (iOS; Android only stores the flag). */
  setSimulateOffline?(on: boolean): void;
  /** Budget in bytes for background song downloads (0 = off). */
  cacheConfigure(bytes: number): void;
  /** Every finished cached song (lastUsed in epoch ms). */
  cacheList(): { id: string; bytes: number; lastUsed: number }[];
  cacheDelete(videoId: string): void;
  cacheClear(): void;
  /** The fully downloaded copy of a song in the background cache (null when not complete). */
  cacheLookup(videoId: string): { path: string; bytes: number } | null;
  /** Background URLSession download in 4 MB Range tasks: resumable, survives app suspension. */
  bgDownloadStart(id: string, spec: BgDownloadSpec): void;
  bgDownloadCancel(id: string): void;
  bgDownloadStatus(): BgDownloadStatus[];
  /** iOS: title / artist / album / duration of a local audio file; the cover bytes are written to `artworkOut` (a path, not a uri). Android: the same through MediaMetadataRetriever. */
  readAudioTags(path: string, artworkOut: string): Promise<AudioTags>;
  /** Loads the extractor page into the headless native WKWebView (see ExtractorWebView.swift). */
  extractorLoad(html: string, baseUrl: string): void;
  extractorEval(js: string): void;
  addListener(event: 'onSongCached', listener: (e: { id: string }) => void): EventSubscription;
  addListener(event: 'onDownloadProgress', listener: (e: { id: string; bytes: number; total: number }) => void): EventSubscription;
  addListener(event: 'onDownloadDone', listener: (e: { id: string; bytes: number }) => void): EventSubscription;
  addListener(event: 'onDownloadFailed', listener: (e: { id: string; reason: string; needsResolve: boolean }) => void): EventSubscription;
  addListener(event: 'onResolveRequest', listener: (e: ResolveRequest) => void): EventSubscription;
  addListener(event: 'onExtractorMessage', listener: (e: { data: string }) => void): EventSubscription;
  addListener(event: 'onExtractorReset', listener: (e: { reason: string }) => void): EventSubscription;
};

export default requireNativeModule<StreamProxyNative>('StreamProxy');
