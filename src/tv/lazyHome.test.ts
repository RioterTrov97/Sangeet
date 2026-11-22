import { HOME_SECTIONS, nextStage, sectionUnlocked, stageAfterFocus } from './lazyHome';
jest.mock('react-native', () => ({ Platform: { isTV: false } }));

describe('lazy Home stages', () => {
  it('unlocks one row at a time up to the last', () => {
    let n = 0;
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) seen.push((n = nextStage(n)));
    expect(seen).toEqual([1, 2, 3, 4, 5, 5, 5, 5]);
    expect(HOME_SECTIONS).toHaveLength(5);
  });
  it('tells which rows are unlocked', () => {
    expect(sectionUnlocked(0, 'top')).toBe(false);
    expect(sectionUnlocked(1, 'top')).toBe(true);
    expect(sectionUnlocked(1, 'personal')).toBe(false);
    expect(sectionUnlocked(5, 'moods')).toBe(true);
  });
  it('focus unlocks the next row but never locks one again', () => {
    expect(stageAfterFocus(0, 'spot')).toBe(0);
    expect(stageAfterFocus(0, 'quick')).toBe(1);
    expect(stageAfterFocus(1, 'top')).toBe(2);
    expect(stageAfterFocus(4, 'top')).toBe(4);
    expect(stageAfterFocus(0, 'moods')).toBe(5);
  });
});
