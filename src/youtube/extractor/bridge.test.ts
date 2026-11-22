import { ExtractorBridge } from './bridge';

function setup() {
  const sent: { id: number; method: string; params?: unknown }[] = [];
  const logs: string[] = [];
  const bridge = new ExtractorBridge((m) => logs.push(m));
  bridge.attach({ post: (m) => sent.push(JSON.parse(m)) });
  return { bridge, sent, logs };
}

describe('ExtractorBridge', () => {
  afterEach(() => jest.useRealTimers());

  it('resolves a request with the matching response', async () => {
    const { bridge, sent } = setup();
    const p = bridge.request<{ a: number }>('getStream', { videoId: 'x' });
    expect(sent[0]).toMatchObject({ method: 'getStream', params: { videoId: 'x' } });
    bridge.handleMessage(JSON.stringify({ type: 'response', id: sent[0].id, ok: true, result: { a: 1 } }));
    await expect(p).resolves.toEqual({ a: 1 });
  });

  it('rejects with the page error', async () => {
    const { bridge, sent } = setup();
    const p = bridge.request('getStream');
    bridge.handleMessage(JSON.stringify({ type: 'response', id: sent[0].id, ok: false, error: 'boom' }));
    await expect(p).rejects.toThrow('boom');
  });

  it('matches concurrent requests by id', async () => {
    const { bridge, sent } = setup();
    const a = bridge.request<string>('m');
    const b = bridge.request<string>('m');
    bridge.handleMessage(JSON.stringify({ type: 'response', id: sent[1].id, ok: true, result: 'B' }));
    bridge.handleMessage(JSON.stringify({ type: 'response', id: sent[0].id, ok: true, result: 'A' }));
    await expect(a).resolves.toBe('A');
    await expect(b).resolves.toBe('B');
  });

  it('times out', async () => {
    jest.useFakeTimers();
    const { bridge } = setup();
    const p = bridge.request('slow', undefined, 1000);
    const assertion = expect(p).rejects.toThrow(/timed out after 1000ms/);
    jest.advanceTimersByTime(1001);
    await assertion;
  });

  it('forwards logs, ignores garbage and unknown ids', () => {
    const { bridge, logs } = setup();
    bridge.handleMessage('not json');
    bridge.handleMessage(JSON.stringify({ type: 'response', id: 99, ok: true, result: 1 }));
    bridge.handleMessage(JSON.stringify({ type: 'log', message: 'hi' }));
    expect(logs).toEqual(['hi']);
  });

  it('whenReady resolves after the ready message; reset rejects in-flight', async () => {
    const { bridge } = setup();
    let ready = false;
    void bridge.whenReady().then(() => (ready = true));
    await Promise.resolve();
    expect(ready).toBe(false);
    bridge.handleMessage(JSON.stringify({ type: 'ready' }));
    await Promise.resolve();
    expect(ready).toBe(true);
    const p = bridge.request('x');
    bridge.reset('reloaded');
    await expect(p).rejects.toThrow('reloaded');
  });

  it('rejects without a transport', async () => {
    const bridge = new ExtractorBridge();
    await expect(bridge.request('x')).rejects.toThrow('no transport');
  });
});
