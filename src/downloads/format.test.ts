import { autoUsage, fmtBytes } from './format';

describe('download sizes', () => {
  it('formats bytes', () => {
    expect(fmtBytes(312 * 1024 ** 2)).toBe('312 MB');
    expect(fmtBytes(1.5 * 1024 ** 3)).toBe('1.50 GB');
  });
  it('shows used of budget', () => {
    expect(autoUsage(312 * 1024 ** 2, 1024)).toBe('312 MB of 1 GB');
    expect(autoUsage(0, 500)).toBe('0 MB of 500 MB');
    expect(autoUsage(1024 ** 2, 0)).toContain('off');
  });
});
