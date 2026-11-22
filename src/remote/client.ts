import type { Dialer, Link } from './link';
import { decode, encode, LineBuffer, PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from './protocol';

export type ClientStatus = 'connecting' | 'ready' | 'closed';

export type ClientEvents = {
  onStatus(status: ClientStatus, info?: { error?: string }): void;
  /** Any message after authentication (state, tick). */
  onMessage(msg: ServerMsg): void;
  onTv?(tv: { tvId: string; name: string }): void;
};

/** Phone side of one TCP connection to a TV. Reconnecting is the caller's job (a new RemoteClient per attempt). */
export class RemoteClient {
  private link?: Link;
  private buf = new LineBuffer();
  status: ClientStatus = 'connecting';
  lastSeen = Date.now();
  private closedByUs = false;

  constructor(private o: { dial: Dialer; deviceId: string; name: string; now?: () => number } & ClientEvents) {}

  connect(target: string): void {
    this.set('connecting');
    this.link = this.o.dial(target, {
      onOpen: () => this.sendRaw({ t: 'hello', v: PROTOCOL_VERSION, deviceId: this.o.deviceId, name: this.o.name }),
      onData: (chunk) => {
        for (const line of this.buf.push(chunk)) this.onLine(line);
      },
      onClose: (error) => {
        if (this.status === 'closed') return;
        this.set('closed', { error: this.closedByUs ? undefined : (error ?? 'Connection closed') });
      },
    });
  }

  private set(status: ClientStatus, info?: { error?: string }) {
    this.status = status;
    this.o.onStatus(status, info);
  }

  private onLine(line: string) {
    const m = decode(line) as ServerMsg | undefined;
    if (!m) return;
    this.lastSeen = (this.o.now ?? Date.now)();
    switch (m.t) {
      case 'welcome':
        this.o.onTv?.({ tvId: m.tvId, name: m.name });
        return this.set('ready');
      case 'error':
        if (m.code === 'bad_message') return; // a rejected command: the session stays up
        return this.set('closed', { error: m.code === 'bad_version' ? 'TV app version is incompatible' : (m.message ?? m.code) });
      default:
        this.o.onMessage(m);
    }
  }

  send(msg: ClientMsg): void {
    if (this.status === 'ready') this.sendRaw(msg);
  }

  private sendRaw(msg: ClientMsg) {
    try {
      this.link?.send(encode(msg));
    } catch {}
  }

  close(): void {
    this.closedByUs = true;
    if (this.status === 'ready') this.sendRaw({ t: 'bye' });
    this.link?.close();
    if (this.status !== 'closed') this.set('closed');
  }
}
