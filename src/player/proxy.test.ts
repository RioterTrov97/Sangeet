const listeners: ((e: { videoId: string; requestId: string; refresh: boolean }) => void)[] = [];
const mockNative = {
  start: jest.fn().mockResolvedValue(5123),
  fulfill: jest.fn(),
  reject: jest.fn(),
  addListener: jest.fn((_: string, l: (typeof listeners)[number]) => void listeners.push(l)),
};
jest.mock('../../modules/stream-proxy', () => ({ __esModule: true, default: mockNative }));

jest.mock('../youtube/extractor/nativeHost', () => ({ startExtractorHost: jest.fn() }));

jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: () => {} }));
jest.mock('expo-secure-store', () => ({}));

const mockResolve = jest.fn();
jest.mock('../youtube/resolver/OnDeviceResolver', () => ({ OnDeviceResolver: jest.fn(() => ({ resolve: mockResolve })) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after the mocks above are initialised
const { prefetch, refreshStream, startProxy, trackUrl } = require('./proxy') as typeof import('./proxy');

const stream = { url: 'https://gv/x', mimeType: 'audio/mp4', contentLength: 100, expiresAt: 9e12, itag: 140, initRange: { start: 0, end: 631 }, indexRange: { start: 632, end: 1000 } };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('lazy resolve bridge', () => {
  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await startProxy();
  });
  beforeEach(() => jest.clearAllMocks());

  it('builds stable URLs from the proxy port', () => {
    expect(trackUrl('abc')).toBe('http://127.0.0.1:5123/v/abc.m3u8');
  });

  it('fulfils a resolve request with the sidx/init ranges', async () => {
    mockResolve.mockResolvedValueOnce(stream);
    listeners[0]({ videoId: 'abc', requestId: 'r1', refresh: false });
    await flush();
    expect(mockResolve).toHaveBeenCalledWith('abc', expect.objectContaining({ fresh: false }));
    expect(mockNative.fulfill).toHaveBeenCalledWith('r1', 'abc', expect.objectContaining({ url: stream.url, initEnd: 631, indexStart: 632, indexEnd: 1000 }));
  });

  it('asks the resolver for a fresh URL on refresh (403) requests', async () => {
    mockResolve.mockResolvedValueOnce(stream);
    listeners[0]({ videoId: 'abc', requestId: 'r2', refresh: true });
    await flush();
    expect(mockResolve).toHaveBeenCalledWith('abc', expect.objectContaining({ fresh: true }));
  });

  it('rejects the request when resolving fails', async () => {
    mockResolve.mockRejectedValueOnce(new Error('boom'));
    listeners[0]({ videoId: 'bad', requestId: 'r3', refresh: false });
    await flush();
    expect(mockNative.reject).toHaveBeenCalledWith('r3', expect.stringContaining('Could not resolve bad'));
  });

  it('never resolves a song from this iPhone: no prefetch, no refresh, a rejected request', async () => {
    mockResolve.mockResolvedValue(stream);
    prefetch('local-0123456789abcdef');
    await refreshStream('local-0123456789abcdef');
    listeners[0]({ videoId: 'local-0123456789abcdef', requestId: 'rl', refresh: false });
    await flush();
    expect(mockResolve).not.toHaveBeenCalled();
    expect(mockNative.fulfill).not.toHaveBeenCalled();
    expect(mockNative.reject).toHaveBeenCalledWith('rl', expect.any(String));
  });

  it('prefetch primes the proxy once per id without a request id', async () => {
    mockResolve.mockResolvedValue(stream);
    prefetch('next1');
    prefetch('next1');
    await flush();
    expect(mockNative.fulfill).toHaveBeenCalledTimes(1);
    expect(mockNative.fulfill).toHaveBeenCalledWith(null, 'next1', expect.anything());
  });
});
