import { requireOptionalNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';

import type { Dialer, Link, LinkHandlers } from '../../src/remote/link';

export type DiscoveredTv = { key: string; name: string; tvId: string; found: boolean };

type Native = {
  startBrowse(): void;
  stopBrowse(): void;
  connect(target: string): string;
  startServer(port: number, name: string, tvId: string): number;
  stopServer(): void;
  send(conn: string, data: string): void;
  close(conn: string): void;
  randomHex(bytes: number): string;
  addListener(event: string, listener: (e: never) => void): EventSubscription;
};

/** iOS: Bonjour browser + TCP client (Swift). Android: TCP server + mDNS registration (Kotlin). */
const native = requireOptionalNativeModule<Native>('SangeetRemote');
export const remoteNativeAvailable = !!native;

const conns = new Map<string, LinkHandlers>();
let wired = false;
let onAccept: ((conn: string, remote: string) => LinkHandlers) | undefined;

function wire(n: Native) {
  if (wired) return;
  wired = true;
  n.addListener('onOpen', ((e: { conn: string }) => conns.get(e.conn)?.onOpen()) as never);
  n.addListener('onData', ((e: { conn: string; data: string }) => conns.get(e.conn)?.onData(e.data)) as never);
  n.addListener('onClose', ((e: { conn: string; error?: string }) => {
    const h = conns.get(e.conn);
    conns.delete(e.conn);
    h?.onClose(e.error);
  }) as never);
  n.addListener('onAccept', ((e: { conn: string; remote: string }) => {
    if (onAccept) conns.set(e.conn, onAccept(e.conn, e.remote));
  }) as never);
}

const linkFor = (n: Native, id: string): Link => ({ send: (line) => n.send(id, line), close: () => n.close(id) });

/** Phone: opens a TCP connection to "host:port" or "svc:<discovered key>". */
export const dial: Dialer = (target, handlers) => {
  if (!native) {
    setTimeout(() => handlers.onClose('Remote control is not available in this build'), 0);
    return { send() {}, close() {} };
  }
  wire(native);
  const id = native.connect(target);
  conns.set(id, handlers);
  return linkFor(native, id);
};

/** Phone: Bonjour discovery. Returns a stop function. */
export function browseTvs(listener: (tv: DiscoveredTv) => void): () => void {
  if (!native) return () => {};
  const sub = native.addListener('onService', listener as never);
  native.startBrowse();
  return () => {
    sub.remove();
    native.stopBrowse();
  };
}

/** TV: listens on `port` (0 = any free port) and advertises over mDNS. Returns the bound port. */
export function listen(port: number, name: string, tvId: string, accept: (conn: string, link: Link) => LinkHandlers): number {
  if (!native) throw new Error('Remote server is not available in this build');
  wire(native);
  onAccept = (conn) => accept(conn, linkFor(native, conn));
  return native.startServer(port, name, tvId);
}

export function randomHex(bytes: number): string {
  if (native) return native.randomHex(bytes);
  // Test / web fallback only; real builds always have the native module.
  return Array.from({ length: bytes }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
}
