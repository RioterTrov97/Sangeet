import { native } from '../../modules/app-updater';
import { CHECK_EVERY_MS, checkForUpdate, installNow, setAutoUpdate, shouldAutoInstall, updateNow, useUpdate } from './store';

let mockStatus = 'idle';
let mockFeed: string | null = 'https://feed/releases';
const release = { tag_name: 'v0.2.0', draft: false, body: 'n', assets: [{ name: 'sangeet-tv-v0.2.0.apk', browser_download_url: 'https://x/a.apk', size: 1 }] };

jest.mock('../../modules/app-updater', () => ({
  native: {
    canInstall: jest.fn(() => true),
    openInstallSettings: jest.fn(),
    download: jest.fn(async () => '/cache/updates/sangeet-tv-v0.2.0.apk'),
    install: jest.fn(async () => ({ status: 0, message: '' })),
    addListener: jest.fn(() => ({ remove() {} })),
  },
}));
jest.mock('../player/store', () => ({ playerState: () => ({ status: mockStatus }), usePlayerStore: { subscribe: jest.fn() } }));
jest.mock('./config', () => ({ currentVersion: () => '0.1.0', updateFeedUrl: () => mockFeed }));
jest.mock('../util/storage', () => {
  const m = new Map<string, string>();
  return { getJson: (k: string) => (m.has(k) ? JSON.parse(m.get(k)!) : undefined), setJson: (k: string, v: unknown) => void m.set(k, JSON.stringify(v)) };
});

const mockNative = native as unknown as Record<string, jest.Mock>;
const fetchMock = jest.fn();
(global as unknown as { fetch: unknown }).fetch = fetchMock;
const respond = (body: unknown) => fetchMock.mockResolvedValue({ ok: true, json: async () => body });
const reset = () => {
  jest.clearAllMocks();
  mockStatus = 'idle';
  mockFeed = 'https://feed/releases';
  mockNative.canInstall.mockReturnValue(true);
  useUpdate.setState({ status: 'idle', progress: 0, release: null, lastChecked: 0, autoUpdate: true, canInstall: true, error: undefined, file: undefined });
};

describe('check throttle', () => {
  beforeEach(reset);
  it('checks once, then not again within 6 h unless forced', async () => {
    respond([release]);
    await checkForUpdate();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await checkForUpdate();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await checkForUpdate({ force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    useUpdate.setState({ lastChecked: Date.now() - CHECK_EVERY_MS - 1, status: 'idle' });
    await checkForUpdate();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('does nothing when the updater is off', async () => {
    mockFeed = null;
    await checkForUpdate({ force: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('swallows errors on a background check, reports them on a forced one', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await checkForUpdate();
    expect(useUpdate.getState().status).toBe('idle');
    await checkForUpdate({ force: true });
    expect(useUpdate.getState().status).toBe('error');
  });
});

describe('download and install policy', () => {
  beforeEach(reset);
  it('downloads right away with auto-update on, then installs when nothing is playing', async () => {
    respond([release]);
    await checkForUpdate({ force: true });
    await new Promise((r) => setImmediate(r));
    expect(mockNative.download).toHaveBeenCalledWith('https://x/a.apk', null, 'sangeet-tv-v0.2.0.apk');
    expect(mockNative.install).toHaveBeenCalledTimes(1);
  });
  it('downloads but does not install while playing', async () => {
    mockStatus = 'playing';
    respond([release]);
    await checkForUpdate({ force: true });
    await new Promise((r) => setImmediate(r));
    expect(mockNative.download).toHaveBeenCalled();
    expect(mockNative.install).not.toHaveBeenCalled();
    expect(useUpdate.getState().status).toBe('ready');
  });
  it('with auto-update off only finds the update; Update downloads and installs', async () => {
    useUpdate.setState({ autoUpdate: false });
    respond([release]);
    await checkForUpdate({ force: true });
    expect(mockNative.download).not.toHaveBeenCalled();
    expect(useUpdate.getState().status).toBe('available');
    await updateNow();
    expect(mockNative.download).toHaveBeenCalledTimes(1);
    expect(mockNative.install).toHaveBeenCalledTimes(1);
  });
  it('installNow sends the user to settings when installs are not allowed', async () => {
    useUpdate.setState({ status: 'ready', file: '/f.apk', canInstall: false, release: { version: '0.2.0', notes: '', apkUrl: 'u', size: 0, fileName: 'a.apk' } });
    mockNative.canInstall.mockReturnValue(false);
    await installNow();
    expect(mockNative.openInstallSettings).toHaveBeenCalled();
    expect(mockNative.install).not.toHaveBeenCalled();
  });
  it('turning auto-update on starts the download of a found update', async () => {
    useUpdate.setState({ autoUpdate: false, status: 'available', release: { version: '0.2.0', notes: '', apkUrl: 'u', size: 0, fileName: 'a.apk' } });
    setAutoUpdate(true);
    await new Promise((r) => setImmediate(r));
    expect(mockNative.download).toHaveBeenCalled();
  });
  it('shouldAutoInstall requires on + ready + allowed + idle', () => {
    const ok = { autoUpdate: true, status: 'ready' as const, canInstall: true };
    expect(shouldAutoInstall(ok, false)).toBe(true);
    expect(shouldAutoInstall(ok, true)).toBe(false);
    expect(shouldAutoInstall({ ...ok, autoUpdate: false }, false)).toBe(false);
    expect(shouldAutoInstall({ ...ok, status: 'available' }, false)).toBe(false);
    expect(shouldAutoInstall({ ...ok, canInstall: false }, false)).toBe(false);
  });
});
