import { containerTop, contentTop, sheetTopInset } from './insets';

describe('insets', () => {
  it('pads the container only in safe and sheet modes', () => {
    expect(containerTop('safe', 59)).toBe(59);
    expect(containerTop('sheet', 59)).toBe(12);
    expect(containerTop('header', 59)).toBe(0);
    expect(containerTop('under', 59)).toBe(0);
    expect(containerTop('none', 59)).toBe(0);
  });
  it('reserves content offset for under and header', () => {
    expect(contentTop('under', 59)).toBe(59);
    expect(contentTop('header', 59)).toBe(119);
    expect(contentTop('safe', 59)).toBe(0);
    expect(contentTop('sheet', 59)).toBe(0);
  });
  it('never adds the status-bar inset inside a card sheet', () => {
    expect(sheetTopInset(false, 59)).toBe(12);
    expect(sheetTopInset(true, 59)).toBe(67);
  });
});
