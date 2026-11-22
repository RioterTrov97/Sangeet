import { planPart } from './syncPlan';

describe('planPart', () => {
  it('removes an item that was synced before and is gone remotely', () => {
    const p = planPart({ remote: ['a'], complete: true, localYt: ['a', 'b'], snapshot: ['a', 'b'] });
    expect(p.remove).toEqual(['b']);
    expect(p.snapshot).toEqual(['a']);
  });
  it('keeps an item that was never synced (added locally since): not in the snapshot', () => {
    const p = planPart({ remote: ['a'], complete: true, localYt: ['a', 'new'], snapshot: ['a'] });
    expect(p.remove).toEqual([]);
  });
  it('without a snapshot the local YouTube rows count as seen', () => {
    expect(planPart({ remote: ['a'], complete: true, localYt: ['a', 'b'] }).remove).toEqual(['b']);
  });
  it('never deletes from an empty response while local has items', () => {
    const p = planPart({ remote: [], complete: true, localYt: ['a', 'b'], snapshot: ['a', 'b'] });
    expect(p.remove).toEqual([]);
    expect(p.skipped).toBe('empty-remote');
    expect(p.snapshot).toEqual(['a', 'b']); // the snapshot is not wiped either
  });
  it('an empty remote with nothing local is fine', () => {
    expect(planPart({ remote: [], complete: true, localYt: [] })).toEqual({ remove: [], snapshot: [] });
  });
  it('never deletes when a continuation was not followed (truncated), but remembers what it saw', () => {
    const p = planPart({ remote: ['a'], complete: false, localYt: ['a', 'b'], snapshot: ['a', 'b'] });
    expect(p.remove).toEqual([]);
    expect(p.skipped).toBe('incomplete');
    expect(p.snapshot.sort()).toEqual(['a', 'b']);
  });
  it('leaves items the user toggled during the run alone', () => {
    const p = planPart({ remote: ['a'], complete: true, localYt: ['a', 'b'], snapshot: ['a', 'b'], touched: new Set(['b']) });
    expect(p.remove).toEqual([]);
  });
});
