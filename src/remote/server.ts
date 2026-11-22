import { decode, encode, isAllowed, isRemoteLayout, isWireTrack, LineBuffer, PROTOCOL_MINOR, PROTOCOL_VERSION, type ClientMsg, type ServerMsg, type TvSnapshot } from './protocol';
import type { Link } from './link';

/** What the TV does with an authenticated command. Implemented in host.ts against the player. */
export type CommandHandler = (msg: Exclude<ClientMsg, { t: 'hello' | 'bye' }>, from: { deviceId: string; name: string }) => void;

export type ServerOptions = {
  tvId: string;
  name: string;
  handle: CommandHandler;
  snapshot: () => TvSnapshot;
  /** A phone is now controlling (or stopped controlling) this TV. */
  onController?: (name: string, connected: boolean) => void;
};

class Session {
  authed = false;
  deviceId = '';
  name = '';
  readonly buf = new LineBuffer();
  constructor(readonly link: Link) {}
}

/** TV side: authenticates connections, dispatches commands, broadcasts state. Transport-agnostic. */
export class RemoteServer {
  private sessions = new Set<Session>();
  constructor(private o: ServerOptions) {}

  /** A new TCP connection. Returns the hooks the transport must call. */
  accept(link: Link): { onData(chunk: string): void; onClose(): void } {
    const s = new Session(link);
    this.sessions.add(s);
    return {
      onData: (chunk) => {
        for (const line of s.buf.push(chunk)) this.onLine(s, line);
      },
      onClose: () => this.drop(s),
    };
  }

  private drop(s: Session) {
    if (!this.sessions.delete(s)) return;
    if (s.authed) this.o.onController?.(s.name, false);
  }

  private send(s: Session, m: ServerMsg) {
    try {
      s.link.send(encode(m));
    } catch {}
  }

  private reject(s: Session, code: Extract<ServerMsg, { t: 'error' }>['code'], close = false) {
    this.send(s, { t: 'error', code });
    if (close) s.link.close();
  }

  private onLine(s: Session, line: string) {
    const m = decode(line) as ClientMsg | undefined;
    if (!m) return this.reject(s, 'bad_message');
    if (!isAllowed(s.authed, m.t)) return this.reject(s, 'unauthorized');
    switch (m.t) {
      case 'hello':
        return this.hello(s, m);
      case 'bye':
        return s.link.close();
      default:
        return this.command(s, m);
    }
  }

  private hello(s: Session, m: Extract<ClientMsg, { t: 'hello' }>) {
    if (typeof m.v !== 'number' || Math.floor(m.v) !== PROTOCOL_VERSION) return this.reject(s, 'bad_version', true);
    if (typeof m.deviceId !== 'string' || !m.deviceId) return this.reject(s, 'bad_message');
    s.deviceId = m.deviceId;
    s.name = typeof m.name === 'string' && m.name ? m.name.slice(0, 60) : 'Phone';
    this.authorize(s);
  }

  private authorize(s: Session) {
    s.authed = true;
    this.send(s, { t: 'welcome', v: PROTOCOL_VERSION, minor: PROTOCOL_MINOR, tvId: this.o.tvId, name: this.o.name });
    this.send(s, { t: 'state', ...this.o.snapshot() });
    this.o.onController?.(s.name, true);
  }

  private command(s: Session, m: Exclude<ClientMsg, { t: 'hello' | 'bye' }>) {
    // Validate payloads here so the player never sees malformed tracks from the network.
    if (!validPayload(m)) return this.reject(s, 'bad_message');
    if ((m.t === 'playQueue' && (!Array.isArray(m.tracks) || !m.tracks.every(isWireTrack) || typeof m.index !== 'number')) || (m.t === 'setLayout' && !isRemoteLayout((m as { layout?: unknown }).layout)) || ((m.t === 'addToQueue' || m.t === 'playNext') && !isWireTrack(m.track))) return this.reject(s, 'bad_message');
    this.o.handle(m, { deviceId: s.deviceId, name: s.name });
  }

  /** Full state to every authenticated phone (on change). */
  broadcastState() {
    const snap = { t: 'state', ...this.o.snapshot() } as const;
    for (const s of this.sessions) if (s.authed) this.send(s, snap);
  }

  /** Heartbeat. */
  broadcastTick() {
    if (![...this.sessions].some((s) => s.authed)) return;
    const { position, duration, status, songPosition, songDuration } = this.o.snapshot();
    const tick: ServerMsg = { t: 'tick', position, duration, status, at: Date.now(), ...(songPosition !== undefined ? { songPosition } : {}), ...(songDuration !== undefined ? { songDuration } : {}) };
    for (const s of this.sessions) if (s.authed) this.send(s, tick);
  }

  get controllers(): string[] {
    return [...this.sessions].filter((s) => s.authed).map((s) => s.name);
  }
}


/** Payload checks for the commands that carry values the player would otherwise trust. */
export function validPayload(m: Exclude<ClientMsg, { t: 'hello' | 'bye' }>): boolean {
  switch (m.t) {
    case 'seek':
      return typeof m.sec === 'number' && Number.isFinite(m.sec);
    case 'chooseVideo':
      return m.videoId === null || (typeof m.videoId === 'string' && m.videoId.length > 0 && m.videoId.length < 64);
    case 'setLyricsOffset':
      return typeof m.ms === 'number' && Number.isFinite(m.ms);
    default:
      return true;
  }
}
