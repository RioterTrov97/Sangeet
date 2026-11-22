import { RemoteClient, type ClientStatus } from './client';
import type { Dialer, Link, LinkHandlers } from './link';
import { applyTick, applyTvState, buildSnapshot, localAfterLeave, shouldHandOver } from './mirror';
import { decode, encode, fromWire, PROTOCOL_VERSION, toWire, type ClientMsg, type ServerMsg, type TvSnapshot } from './protocol';
import { RemoteServer } from './server';
import type { PlayerStoreState } from '../player/store';
import type { Track } from '../youtube/models';

const flush = () => new Promise((r) => setTimeout(r, 0));
const mk = (id: string): Track => ({ kind: 'track', id, title: `T ${id}`, artists: [{ name: 'Artist' }], artwork: [{ url: `https://i/${id}.jpg` }], durationSec: 100 });

const idle: PlayerStoreState = { queue: [], index: 0, original: null, shuffle: false, repeat: 'off', status: 'idle', position: 0, duration: 0, userAdded: [], loadingRadio: false };
const snap = (over: Partial<TvSnapshot> = {}): TvSnapshot => ({ track: null, position: 0, duration: 0, status: 'idle', queue: [], index: 0, mode: 'audio', shuffle: false, repeat: 'off', ...over });

/** In-memory "TCP": a dialer wired straight to a RemoteServer. */
function loopback(server: RemoteServer): { dial: Dialer; raw: (line: string) => void } {
  let toServer: { onData(c: string): void; onClose(): void } | undefined;
  const dial: Dialer = (_t, h: LinkHandlers) => {
    const fromServer: Link = { send: (l) => queueMicrotask(() => h.onData(l)), close: () => queueMicrotask(() => h.onClose()) };
    toServer = server.accept(fromServer);
    queueMicrotask(() => h.onOpen());
    return { send: (l) => queueMicrotask(() => toServer!.onData(l)), close: () => queueMicrotask(() => toServer!.onClose()) };
  };
  return { dial, raw: (l) => toServer!.onData(l) };
}

function setup() {
  const handled: ClientMsg[] = [];
  const controllers: string[] = [];
  const server = new RemoteServer({
    tvId: 'tv1',
    name: 'Living Room',
    handle: (m) => void handled.push(m),
    snapshot: () => snap({ status: 'paused' }),
    onController: (name, on) => void controllers.push(`${on ? '+' : '-'}${name}`),
  });
  return { server, handled, controllers };
}

function phone(dial: Dialer) {
  const statuses: ClientStatus[] = [];
  const msgs: ServerMsg[] = [];
  const client = new RemoteClient({ dial, deviceId: 'phone1', name: 'iPhone', onStatus: (s) => statuses.push(s), onMessage: (m) => msgs.push(m) });
  client.connect('tv:8765');
  return { client, statuses, msgs };
}

const raw = (lb: ReturnType<typeof loopback>) => {
  const got: ServerMsg[] = [];
  lb.dial('x', { onOpen() {}, onData: (c) => got.push(decode(c) as ServerMsg), onClose() {} });
  return got;
};

describe('session (loopback, no pairing)', () => {
  it('accepts a hello, sends state, then executes commands', async () => {
    const s = setup();
    const p = phone(loopback(s.server).dial);
    await flush();
    expect(p.statuses.at(-1)).toBe('ready');
    expect(s.controllers).toEqual(['+iPhone']);
    expect(p.msgs[0]).toMatchObject({ t: 'state', status: 'paused' });
    p.client.send({ t: 'pause' });
    p.client.send({ t: 'seek', sec: 42 });
    await flush();
    expect(s.handled).toEqual([{ t: 'pause' }, { t: 'seek', sec: 42 }]);
  });

  it('rejects every command before hello', async () => {
    const s = setup();
    const lb = loopback(s.server);
    const got = raw(lb);
    lb.raw(encode({ t: 'play' }));
    lb.raw(encode({ t: 'playQueue', tracks: [toWire(mk('a'))], index: 0 }));
    lb.raw('garbage\n');
    await flush();
    expect(got.map((g) => (g.t === 'error' ? g.code : g.t))).toEqual(['unauthorized', 'unauthorized', 'bad_message']);
    expect(s.handled).toEqual([]);
  });

  it('refuses an incompatible protocol version and a hello without a device id', async () => {
    const s = setup();
    const lb = loopback(s.server);
    const got = raw(lb);
    lb.raw(encode({ t: 'hello', v: PROTOCOL_VERSION + 1, deviceId: 'p', name: 'P' }));
    lb.raw('{"t":"hello","v":1}\n');
    await flush();
    expect(got[0]).toMatchObject({ t: 'error', code: 'bad_version' });
    expect(s.handled).toEqual([]);
  });

  it('validates payloads and ignores unknown commands', async () => {
    const s = setup();
    const lb = loopback(s.server);
    const p = phone(lb.dial);
    await flush();
    lb.raw('{"t":"playQueue","tracks":[{"title":"no id"}],"index":0}\n');
    lb.raw('{"t":"addToQueue","track":5}\n');
    expect(s.handled).toEqual([]);
    p.client.send({ t: 'playQueue', tracks: [toWire(mk('a')), toWire(mk('b'))], index: 1, position: 30 });
    await flush();
    expect(s.handled).toHaveLength(1);
    expect(s.handled[0]).toMatchObject({ t: 'playQueue', index: 1, position: 30 });
    lb.raw('{"t":"formatDisk"}\n'); // unknown: passed to the handler, which ignores types it does not know
    expect(p.client.status).toBe('ready');
  });

  it('accepts the Phase 13 setLayout command (and still the old setMode), rejecting unknown layouts', async () => {
    const s = setup();
    const lb = loopback(s.server);
    const p = phone(lb.dial);
    await flush();
    p.client.send({ t: 'setMode', mode: 'video' });
    p.client.send({ t: 'setLayout', layout: 'musicLyrics' });
    lb.raw('{"t":"setLayout","layout":"sideways"}\n');
    lb.raw('{"t":"setLayout"}\n');
    await flush();
    expect(s.handled).toEqual([{ t: 'setMode', mode: 'video' }, { t: 'setLayout', layout: 'musicLyrics' }]);
  });

  it('adds the layout to snapshots only when the TV has one (older phones ignore it)', () => {
    expect(buildSnapshot(idle, 'audio')).not.toHaveProperty('layout');
    expect(buildSnapshot(idle, 'video', 'lyrics')).toMatchObject({ mode: 'video', layout: 'lyrics' });
  });

  it('broadcasts state and heartbeats only after hello', async () => {
    const s = setup();
    const p = phone(loopback(s.server).dial);
    const stranger: ServerMsg[] = [];
    loopback(s.server).dial('x', { onOpen() {}, onData: (c) => stranger.push(decode(c) as ServerMsg), onClose() {} });
    await flush();
    const before = p.msgs.length;
    s.server.broadcastState();
    s.server.broadcastTick();
    await flush();
    expect(p.msgs.slice(before).map((m) => m.t)).toEqual(['state', 'tick']);
    expect(stranger).toEqual([]);
  });
});

describe('remote-mode store reducer', () => {
  const tvQueue = ['a', 'b', 'c'].map(mk);

  it('mirrors the TV snapshot into the player store', () => {
    const next = applyTvState(idle, snap({ queue: tvQueue.map(toWire), index: 1, status: 'playing', position: 12, duration: 100, shuffle: true, repeat: 'all' }));
    expect(next).toMatchObject({ index: 1, status: 'playing', position: 12, duration: 100, shuffle: true, repeat: 'all', original: null, userAdded: [] });
    expect(next.queue?.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the same queue array when the TV queue is unchanged', () => {
    const first = applyTvState(idle, snap({ queue: tvQueue.map(toWire) }));
    const again = applyTvState({ ...idle, ...first } as PlayerStoreState, snap({ queue: tvQueue.map(toWire), index: 2 }));
    expect(again.queue).toBe(first.queue);
  });

  it('applies heartbeats, ignoring no-ops', () => {
    const s = { ...idle, queue: tvQueue, status: 'playing' as const, position: 5, duration: 100 };
    expect(applyTick(s, { position: 6, duration: 100, status: 'playing' })).toEqual({ position: 6, status: 'playing', duration: 100 });
    expect(applyTick(s, { position: 5, duration: 100, status: 'playing' })).toEqual({});
    expect(applyTick(s, { position: 6, duration: 0, status: 'paused' }).duration).toBe(100);
  });

  it('builds the TV snapshot from the store (and round-trips it)', () => {
    const s = { ...idle, queue: tvQueue, index: 2, status: 'paused' as const, position: 7, duration: 0 };
    const snapshot = buildSnapshot(s, 'video');
    expect(snapshot).toMatchObject({ index: 2, status: 'paused', position: 7, duration: 100, mode: 'video' });
    expect(snapshot.track?.videoId).toBe('c');
    expect(applyTvState(idle, snapshot).queue?.map((t) => fromWire(toWire(t)).id)).toEqual(['a', 'b', 'c']);
  });
});

describe('leaving and joining remote mode', () => {
  const q = ['a', 'b'].map(mk);
  it('hands the phone song over (and plays) whenever one is selected, even paused', () => {
    expect(shouldHandOver({ queue: q, status: 'playing' })).toBe(true);
    expect(shouldHandOver({ queue: q, status: 'buffering' })).toBe(true);
    expect(shouldHandOver({ queue: q, status: 'paused' })).toBe(true);
  });
  it('a phone with nothing selected mirrors the TV instead', () => {
    expect(shouldHandOver({ queue: [], status: 'idle' })).toBe(false);
    expect(shouldHandOver({ queue: [], status: 'playing' })).toBe(false);
  });

  it('returns to the last local state, stopped, after leaving', () => {
    const local = { ...idle, queue: q, index: 1, position: 12, status: 'playing' as const };
    expect(localAfterLeave(local)).toMatchObject({ queue: q, index: 1, position: 12, status: 'paused', loadingRadio: false });
    expect(localAfterLeave(idle).status).toBe('idle');
  });

  it('does not send a pause or any command when the phone leaves (TV keeps playing)', async () => {
    const s = setup();
    const lb = loopback(s.server);
    const p = phone(lb.dial);
    await flush();
    p.client.close();
    await flush();
    expect(s.handled).toEqual([]);
    expect(s.controllers).toEqual(['+iPhone', '-iPhone']);
  });
});
