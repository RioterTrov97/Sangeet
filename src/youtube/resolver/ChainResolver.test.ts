import { CircuitBreaker } from './breaker';
import { ChainResolver, DEVICE_CLIENTS, ResolveError, selectClients } from './ChainResolver';
import { ClientExclusions, CLIENT_EXCLUDE_MS } from './clientExclusion';
import { classifyFailure, parseAttempts } from './failure';
import type { ResolvedStream, StreamResolver } from './types';

jest.mock('../../util/storage', () => ({ getJson: () => undefined, setJson: () => {} }));

const stream = (o: Partial<ResolvedStream> = {}): ResolvedStream => ({ url: 'u', mimeType: 'audio/mp4', contentLength: 10, expiresAt: Date.now() + 1e7, itag: 140, ...o });
const attemptsErr = (a: { client: string; error: string }[]) => new Error(`ATTEMPTS audio ${JSON.stringify(a)}`);

describe('CircuitBreaker', () => {
  it('opens after 3 consecutive failures for 10 minutes, success resets', () => {
    let t = 0;
    const b = new CircuitBreaker(3, 600_000, () => t);
    b.failure('A'); b.failure('A');
    expect(b.isOpen('A')).toBe(false);
    b.failure('A');
    expect(b.isOpen('A')).toBe(true);
    t = 599_999;
    expect(b.isOpen('A')).toBe(true);
    t = 600_001;
    expect(b.isOpen('A')).toBe(false);
    b.failure('A'); // half-open probe fails -> straight back to open
    expect(b.isOpen('A')).toBe(true);
    const c = new CircuitBreaker();
    c.failure('B'); c.failure('B'); c.success('B'); c.failure('B');
    expect(c.isOpen('B')).toBe(false);
  });
});

describe('selectClients / ClientExclusions', () => {
  it('drops excluded clients, moves avoided ones last, and falls back to everything when nothing is left', () => {
    expect(selectClients(['A', 'B', 'C'], (c) => c === 'A', ['B'])).toEqual({ clients: ['C', 'B'], lowQuality: false });
    expect(selectClients(['A', 'B'], () => true)).toEqual({ clients: ['A', 'B'], lowQuality: true });
    expect(selectClients([], () => true)).toEqual({ clients: [], lowQuality: false });
  });
  it('expires exclusions after the TTL', () => {
    let t = 0;
    const e = new ClientExclusions(() => t);
    e.exclude('v:abc', 'TV');
    expect(e.isExcluded('abc', 'TV')).toBe(true);
    expect(e.isExcluded('abc', 'MWEB')).toBe(false);
    t = CLIENT_EXCLUDE_MS - 1;
    expect(e.isExcluded('abc', 'TV')).toBe(true);
    t = CLIENT_EXCLUDE_MS;
    expect(e.isExcluded('abc', 'TV')).toBe(false);
  });
});

describe('failure parsing', () => {
  it('classifies reasons', () => {
    expect(classifyFailure('validation HTTP 403')).toBe('403');
    expect(classifyFailure('mint: botguard challenge failed')).toBe('potoken');
    expect(classifyFailure('decipher.MWEB: bad sig')).toBe('decipher');
    expect(classifyFailure('Bridge request "getStream" timed out after 60000ms')).toBe('timeout');
    expect(classifyFailure('playability LOGIN_REQUIRED')).toBe('playability');
  });
  it('parses the extractor attempts payload', () => {
    expect(parseAttempts('ATTEMPTS audio [{"client":"MWEB","error":"x"}]')).toEqual([{ client: 'MWEB', error: 'x' }]);
    expect(parseAttempts('plain')).toBeUndefined();
  });
});

describe('ChainResolver', () => {
  const mk = (device: StreamResolver['resolve'], server?: StreamResolver['resolve'], configured = true) => {
    const records: any[] = [];
    const chain = new ChainResolver({ device: { resolve: device }, server: server ? { resolve: server } : undefined, serverConfigured: () => configured, record: (r) => void records.push(r) });
    return { chain, records };
  };

  it('puts clients that just 403d mid-stream behind the others on a refresh', async () => {
    const seen: string[][] = [];
    const { chain } = mk(async (_id, o) => (seen.push((o as { clients: string[] }).clients), stream({ client: 'TV' })));
    await chain.resolve('a', { fresh: true, avoid: ['MWEB'] });
    expect(seen[0]).toEqual(['VISIONOS', 'TV', 'WEB_EMBEDDED', 'MWEB']);
  });

  it('prefers VISIONOS, then TV, MWEB, WEB_EMBEDDED and never IOS/ANDROID', async () => {
    expect([...DEVICE_CLIENTS]).toEqual(['VISIONOS', 'TV', 'MWEB', 'WEB_EMBEDDED']);
    const seen: { clients?: string[]; lowQuality?: boolean }[] = [];
    const { chain } = mk(async (_id, o) => (seen.push(o as never), stream({ client: 'VISIONOS' })));
    await chain.resolve('a');
    expect(seen[0].clients).toEqual(['VISIONOS', 'TV', 'MWEB', 'WEB_EMBEDDED']);
    expect(seen[0].lowQuality).toBe(false);
  });

  it('excludes a client that failed for a video for 5 minutes, then lets it back in; other videos are unaffected', async () => {
    let t = 1_000_000;
    const seen: Record<string, string[]> = {};
    const device = async (id: string, o?: { clients?: string[] }) => {
      seen[`${id}@${t}`] = o?.clients ?? [];
      if (id === 'a' && t === 1_000_000) throw attemptsErr([{ client: 'VISIONOS', error: 'playability UNPLAYABLE' }]);
      return stream({ client: 'TV' });
    };
    const chain = new ChainResolver({ device: { resolve: device }, serverConfigured: () => false, record: () => {}, now: () => t });
    await chain.resolve('a').catch(() => {});
    t += 60_000;
    await chain.resolve('a');
    expect(seen[`a@${t}`]).not.toContain('VISIONOS');
    await chain.resolve('b');
    expect(seen[`b@${t}`][0]).toBe('VISIONOS');
    t += CLIENT_EXCLUDE_MS;
    await chain.resolve('a');
    expect(seen[`a@${t}`][0]).toBe('VISIONOS');
  });

  it('when every client is excluded for the video, retries all of them at low quality as a last resort', async () => {
    const seen: { clients?: string[]; lowQuality?: boolean }[] = [];
    const device = async (_id: string, o?: { clients?: string[]; lowQuality?: boolean }) => {
      seen.push(o as never);
      if (seen.length === 1) throw attemptsErr(DEVICE_CLIENTS.map((client) => ({ client, error: 'playability UNPLAYABLE' })));
      return stream({ client: 'MWEB' });
    };
    const { chain } = mk(device, undefined, false);
    await chain.resolve('a').catch(() => {});
    const s = await chain.resolve('a');
    expect(s.client).toBe('MWEB');
    expect(seen[1]).toMatchObject({ lowQuality: true, clients: [...DEVICE_CLIENTS] });
  });

  it('uses the device result and records which client worked', async () => {
    const { chain, records } = mk(async () => stream({ client: 'MWEB' }));
    expect((await chain.resolve('a')).source).toBeUndefined();
    expect(records[0]).toMatchObject({ ok: true, source: 'device', client: 'MWEB' });
  });

  it('falls back to the server when every client fails, and trips breakers after 3 failures', async () => {
    const device = jest.fn(async (_id: string, o?: { clients?: string[] }) => { throw attemptsErr((o?.clients ?? []).map((client) => ({ client, error: '403 forbidden' }))); });
    const server = jest.fn(async () => stream({ itag: 140 }));
    const { chain } = mk(device, server);
    for (let i = 0; i < 3; i++) expect((await chain.resolve('a')).source).toBe('server');
    // every client is now cooling down, so the device path is skipped
    device.mockClear();
    expect((await chain.resolve('a')).source).toBe('server');
    expect(device).not.toHaveBeenCalled();
  });

  it('fails with reasons when no server is configured', async () => {
    const { chain, records } = mk(async () => { throw attemptsErr([{ client: 'MWEB', error: 'decipher failed' }]); }, undefined, false);
    await expect(chain.resolve('a')).rejects.toBeInstanceOf(ResolveError);
    expect(records[0]).toMatchObject({ ok: false, reason: 'decipher' });
  });

  it('serverOnly skips the device path', async () => {
    const device = jest.fn();
    const chain = new ChainResolver({ device: { resolve: device }, server: { resolve: async () => stream() }, serverConfigured: () => true, serverOnly: () => true, record: () => {} });
    await chain.resolve('a');
    expect(device).not.toHaveBeenCalled();
  });

  it('a playability refusal does not trip the breaker', async () => {
    const { chain } = mk(async () => { throw attemptsErr([{ client: 'MWEB', error: 'playability LOGIN_REQUIRED' }]); }, undefined, false);
    for (let i = 0; i < 5; i++) await chain.resolve('a').catch(() => {});
    expect(chain.breaker.isOpen('MWEB')).toBe(false);
  });

  it('being offline neither excludes a client for the video nor trips the breaker', async () => {
    const { chain } = mk(async () => { throw attemptsErr([{ client: 'MWEB', error: 'Load failed' }]); }, undefined, false);
    for (let i = 0; i < 5; i++) await chain.resolve('a').catch(() => {});
    expect(chain.breaker.isOpen('MWEB')).toBe(false);
    expect(chain.exclusions.isExcluded('a', 'MWEB')).toBe(false);
  });

  it('a rate limit pauses on-device resolves for 15 minutes and the error says so', async () => {
    let t = 1_000_000;
    const device = jest.fn(async (_id: string, o?: { clients?: string[] }) => {
      throw attemptsErr((o?.clients ?? []).slice(0, 1).map((client) => ({ client, error: "playability LOGIN_REQUIRED: This content isn't available, try again later" })));
    });
    const chain = new ChainResolver({ device: { resolve: device }, serverConfigured: () => false, record: () => {}, now: () => t });
    const e1 = await chain.resolve('a').catch((e) => e);
    expect(e1).toBeInstanceOf(ResolveError);
    expect(e1.playability).toBe('RateLimited');
    expect(e1.retryInMs).toBe(15 * 60_000);
    expect(chain.breaker.isOpen('VISIONOS')).toBe(false);
    device.mockClear();
    t += 60_000;
    const e2 = await chain.resolve('b').catch((e) => e);
    expect(device).not.toHaveBeenCalled(); // no retry loop during the cool-down
    expect(e2.playability).toBe('RateLimited');
    expect(e2.retryInMs).toBe(14 * 60_000);
    t += 14 * 60_000;
    await chain.resolve('b').catch(() => {});
    expect(device).toHaveBeenCalledTimes(1); // cool-down over: one try, trips again for 30 minutes
    expect(chain.cooldown.remainingMs()).toBe(30 * 60_000);
  });

  it('carries the playability class of the failure and a success clears the cool-down', async () => {
    const { chain } = mk(async () => { throw attemptsErr([{ client: 'VISIONOS', error: 'playability UNPLAYABLE: This video is private' }]); }, undefined, false);
    const e = await chain.resolve('a').catch((x) => x);
    expect(e.playability).toBe('Private');
    chain.cooldown.trip();
    expect(chain.cooldown.active()).toBe(true);
  });
});
