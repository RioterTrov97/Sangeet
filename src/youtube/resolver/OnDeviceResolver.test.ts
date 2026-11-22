import { ExtractorBridge } from '../extractor/bridge';
import type { StreamInfo } from '../extractor/protocol';
import { OnDeviceResolver, validate, validateDeep } from './OnDeviceResolver';
import { setQuality } from './qualitySettings';

jest.mock('../../../modules/stream-proxy', () => ({ __esModule: true, default: {} }));
jest.mock('../../util/storage', () => ({ getJson: () => undefined, setJson: () => {} }));

const info = (): StreamInfo => ({
  url: 'https://gv/x',
  mimeType: 'audio/mp4',
  contentLength: 1000,
  expiresAt: Date.now() + 3_600_000,
  itag: 140,
  client: 'WEB',
  userAgent: 'ua',
  timings: {},
});

function fakeBridge() {
  const bridge = new ExtractorBridge();
  const request = jest.fn(async () => info());
  bridge.request = request as unknown as ExtractorBridge['request'];
  bridge.whenReady = () => Promise.resolve();
  return { bridge, request };
}

describe('OnDeviceResolver quality', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());
  it('asks the extractor for the current setting and re-resolves after a change', async () => {
    const { bridge, request } = fakeBridge();
    const r = new OnDeviceResolver(bridge, async () => {});
    setQuality({ audio: 'saver', video: '480' });
    await r.resolve('a1');
    await r.resolve('v:a1');
    expect(request).toHaveBeenNthCalledWith(1, 'getStream', expect.objectContaining({ videoId: 'a1', audio: 'saver' }), 60_000);
    expect(request).toHaveBeenNthCalledWith(2, 'getVideoStream', expect.objectContaining({ videoId: 'a1', video: '480', kind: 'adaptive' }), 60_000);
    setQuality({ audio: 'max' });
    await r.resolve('a1');
    expect(request).toHaveBeenCalledTimes(3);
    setQuality({ audio: 'max', video: 'max' });
  });
});

describe('OnDeviceResolver', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('a slow resolve that finishes after a newer fresh one cannot overwrite it', async () => {
    const bridge = new ExtractorBridge();
    bridge.whenReady = () => Promise.resolve();
    const done: ((i: StreamInfo) => void)[] = [];
    bridge.request = (async () => new Promise<StreamInfo>((res) => done.push(res))) as unknown as ExtractorBridge['request'];
    const r = new OnDeviceResolver(bridge, async () => {});
    const slow = r.resolve('s1');
    const fresh = r.resolve('s1', { fresh: true });
    await new Promise((x) => setTimeout(x, 0));
    expect(done).toHaveLength(2);
    done[1]({ ...info(), url: 'https://gv/new' });
    expect((await fresh).url).toBe('https://gv/new');
    done[0]({ ...info(), url: 'https://gv/old' });
    expect((await slow).url).toBe('https://gv/old'); // its caller still gets what it asked for
    expect((await r.resolve('s1')).url).toBe('https://gv/new'); // but the cache keeps the newer one
  });

  it('caches resolved streams and dedupes concurrent calls', async () => {
    const { bridge, request } = fakeBridge();
    const validate = jest.fn(async () => {});
    const r = new OnDeviceResolver(bridge, validate);
    const [a, b] = await Promise.all([r.resolve('v1'), r.resolve('v1')]);
    expect(a).toBe(b);
    await r.resolve('v1');
    expect(request).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('does not cache when validation fails', async () => {
    const { bridge, request } = fakeBridge();
    const validate = jest.fn().mockRejectedValueOnce(new Error('403')).mockResolvedValue(undefined);
    const r = new OnDeviceResolver(bridge, validate);
    await expect(r.resolve('v1')).rejects.toThrow('403');
    await expect(r.resolve('v1')).resolves.toBeDefined();
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('OnDeviceResolver background deep check', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());
  it('does not wait for the past-1-MiB check, and reports a late failure for MWEB only', async () => {
    const mk = (client: string) => {
      const bridge = new ExtractorBridge();
      bridge.whenReady = () => Promise.resolve();
      bridge.request = (async () => ({ ...info(), client })) as unknown as ExtractorBridge['request'];
      return bridge;
    };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const deep = jest.fn(async () => {
      await gate;
      throw new Error('validation HTTP 403 past 1 MiB');
    });
    const late = jest.fn();
    const r = new OnDeviceResolver(mk('MWEB'), async () => {}, deep, late);
    const s = await r.resolve('m1'); // resolves although the deep check is still pending
    expect(s.client).toBe('MWEB');
    expect(late).not.toHaveBeenCalled();
    release();
    await new Promise((res) => setTimeout(res, 0));
    expect(late).toHaveBeenCalledWith('m1', 'MWEB', expect.stringContaining('past 1 MiB'));
  });
});

describe('OnDeviceResolver client fallback', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());
  it('drops a client whose URL fails validation and resolves with the next one', async () => {
    const bridge = new ExtractorBridge();
    bridge.whenReady = () => Promise.resolve();
    const request = jest.fn(async (_m: string, p: any) => ({ ...info(), client: p.clients[0] }));
    bridge.request = request as unknown as ExtractorBridge['request'];
    const validate = jest.fn(async (s: any) => {
      if (s.client === 'IOS') throw new Error('validation HTTP 403 past 1 MiB');
    });
    const r = new OnDeviceResolver(bridge, validate);
    const s = await r.resolve('z1', { clients: ['IOS', 'MWEB'] });
    expect(s.client).toBe('MWEB');
    expect(request.mock.calls.map((c) => c[1].clients)).toEqual([['IOS', 'MWEB'], ['MWEB']]);
    expect(s.failed?.[0]?.client).toBe('IOS');
  });
});

describe('validate', () => {
  it('validateDeep probes just past 1 MiB for long files on MWEB and rejects a client cut there; VISIONOS/TV are never probed', async () => {
    const ranges: string[] = [];
    (global as any).fetch = jest.fn(async (_u: string, init: any) => {
      ranges.push(init.headers.Range);
      return { status: 403, arrayBuffer: async () => new ArrayBuffer(0) };
    });
    const long = (client: string) => ({ ...info(), client, contentLength: 4_000_000 }) as unknown as Parameters<typeof validate>[0];
    await expect(validateDeep(long('MWEB'))).rejects.toThrow('validation HTTP 403 past 1 MiB');
    expect(ranges).toEqual(['bytes=1310720-1310721']);
    await expect(validateDeep(long('VISIONOS'))).resolves.toBeUndefined();
    await expect(validateDeep(long('TV'))).resolves.toBeUndefined();
    expect(ranges).toHaveLength(1);
  });

  const stream = { ...info() } as unknown as Parameters<typeof validate>[0];
  afterEach(() => jest.restoreAllMocks());

  it('probes the START of the file (bytes=0-1), never the tail, and accepts 206', async () => {
    const fetchMock = jest.fn(async () => ({ status: 206, arrayBuffer: async () => new ArrayBuffer(2) }));
    (global as any).fetch = fetchMock;
    await expect(validate(stream)).resolves.toBeUndefined();
    const headers = (fetchMock.mock.calls[0] as any[])[1].headers;
    expect(headers.Range).toBe('bytes=0-1');
  });
  it('accepts 200 and rejects 403 / empty bodies', async () => {
    (global as any).fetch = jest.fn(async () => ({ status: 200, arrayBuffer: async () => new ArrayBuffer(2) }));
    await expect(validate(stream)).resolves.toBeUndefined();
    (global as any).fetch = jest.fn(async () => ({ status: 403, arrayBuffer: async () => new ArrayBuffer(0) }));
    await expect(validate(stream)).rejects.toThrow('validation HTTP 403');
    (global as any).fetch = jest.fn(async () => ({ status: 206, arrayBuffer: async () => new ArrayBuffer(0) }));
    await expect(validate(stream)).rejects.toThrow('no bytes');
  });
});
