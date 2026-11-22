import { KEY_WINDOW_MS, initialRail, railReduce, type RailEvent, type RailState } from './railState';

const run = (events: RailEvent[], from: RailState = initialRail) => events.reduce((r, e) => railReduce(r.state, e), { state: from } as ReturnType<typeof railReduce>);

describe('rail open/close', () => {
  it('opens when focus enters right after a key press', () => {
    const r = run([{ type: 'key', at: 1000 }, { type: 'focus', name: 'home', at: 1030 }]);
    expect(r.state.open).toBe(true);
    expect(r.reclaim).toBeUndefined();
  });
  it('ignores focus the system moved in without a key and asks content to reclaim it', () => {
    const r = run([{ type: 'focus', name: 'library', at: 5000 }]);
    expect(r.state.open).toBe(false);
    expect(r.reclaim).toBe(true);
  });
  it('a stale key does not count', () => {
    const r = run([{ type: 'key', at: 0 }, { type: 'focus', name: 'home', at: KEY_WINDOW_MS + 1 }]);
    expect(r.state.open).toBe(false);
    expect(r.reclaim).toBe(true);
  });
  it('stays open while moving between rail items, even without a fresh key window', () => {
    const open = run([{ type: 'key', at: 0 }, { type: 'focus', name: 'home', at: 10 }]).state;
    const r = run([{ type: 'focus', name: 'search', at: 99_999 }], open);
    expect(r.state.open).toBe(true);
    expect(r.reclaim).toBeUndefined();
  });
  it('choosing collapses and the chosen item re-focused does not reopen', () => {
    const r = run([{ type: 'key', at: 0 }, { type: 'focus', name: 'home', at: 10 }, { type: 'choose', name: 'home' }, { type: 'focus', name: 'home', at: 20 }]);
    expect(r.state.open).toBe(false);
    expect(r.reclaim).toBeUndefined();
  });
  it('blur then close shuts it; the next key-driven focus opens it again', () => {
    const r = run([{ type: 'key', at: 0 }, { type: 'focus', name: 'home', at: 10 }, { type: 'blur' }, { type: 'close' }, { type: 'key', at: 5000 }, { type: 'focus', name: 'home', at: 5010 }]);
    expect(r.state.open).toBe(true);
  });
  it('idle collapses and remembers the focused item as chosen', () => {
    const r = run([{ type: 'key', at: 0 }, { type: 'focus', name: 'search', at: 10 }, { type: 'idle', focused: 'search' }]);
    expect(r.state).toMatchObject({ open: false, chosen: 'search' });
  });
});
