import { closePlayer, type CloseDeps } from './closePlayer';
import type { Persisted } from './queue';

const snap = { queue: [{ id: 'a' }, { id: 'b' }], index: 1, original: null, shuffle: false, repeat: 'off', position: 42 } as unknown as Persisted;
function deps(over: Partial<CloseDeps> = {}) {
  const calls: string[] = [];
  let undo: (() => void) | undefined;
  let text = '';
  const d: CloseDeps = {
    isRemote: () => false,
    snapshot: () => snap,
    closeLocal: async () => void calls.push('closeLocal'),
    restoreLocal: async (p) => void calls.push(`restore:${p.index}:${p.position}`),
    tvLink: () => ({ target: 'svc:tv1', name: 'Living room', tvId: 't1' }),
    disconnectTv: () => void calls.push('disconnect'),
    connectTv: async (l) => void calls.push(`connect:${l.target}`),
    notify: (t, u) => {
      text = t;
      undo = u;
    },
    haptic: () => void calls.push('haptic'),
    ...over,
  };
  return { d, calls, undo: () => undo?.(), text: () => text };
}

describe('closePlayer', () => {
  it('local: clears, notifies, and Undo restores queue/index/position', async () => {
    const t = deps();
    await closePlayer(t.d);
    expect(t.calls).toEqual(['haptic', 'closeLocal']);
    expect(t.text()).toBe('Player closed');
    t.undo();
    expect(t.calls).toContain('restore:1:42');
  });
  it('local with nothing playing does nothing', async () => {
    const t = deps({ snapshot: () => undefined });
    await closePlayer(t.d);
    expect(t.calls).toEqual(['haptic']);
    expect(t.text()).toBe('');
  });
  it('remote: only disconnects (the TV is left alone), Undo reconnects', async () => {
    const t = deps({ isRemote: () => true });
    await closePlayer(t.d);
    expect(t.calls).toEqual(['haptic', 'disconnect']);
    expect(t.text()).toBe('Disconnected from TV');
    t.undo();
    expect(t.calls).toContain('connect:svc:tv1');
    expect(t.calls).not.toContain('closeLocal');
  });
});
