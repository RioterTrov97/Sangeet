import { contrast } from './color';
import { derivePalette, foregroundFor } from './derive';

const cases: Record<string, { background: string; primary: string; secondary: string; detail: string }> = {
  veryLight: { background: '#fafafa', primary: '#f0f0f0', secondary: '#e8e8e8', detail: '#ffffff' },
  veryDark: { background: '#030303', primary: '#0a0a0a', secondary: '#050505', detail: '#000000' },
  greyscale: { background: '#808080', primary: '#999999', secondary: '#666666', detail: '#aaaaaa' },
  neon: { background: '#00ff66', primary: '#ff00ff', secondary: '#39ff14', detail: '#00ffff' },
  warm: { background: '#8b4a2b', primary: '#d98b3a', secondary: '#5a3b2a', detail: '#f2c27d' },
};

describe('derivePalette', () => {
  for (const [name, raw] of Object.entries(cases)) {
    it(`meets contrast targets for ${name} artwork`, () => {
      const p = derivePalette(raw);
      expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.textDim, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.accent, p.bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#ffffff', p.vivid)).toBeGreaterThanOrEqual(4.5);
      expect(p.bgDeep).not.toBe(p.bg);
      expect(p.glassTint).toMatch(/^rgba\(/);
    });
  }

  it('picks a saturated accent for colourful art and a neutral one for greyscale', () => {
    expect(derivePalette(cases.neon).accent).not.toBe('#ffffff');
    const g = derivePalette(cases.greyscale);
    const [r, gg, b] = [1, 3, 5].map((i) => parseInt(g.accent.slice(i, i + 2), 16));
    expect(Math.max(r, gg, b) - Math.min(r, gg, b)).toBeLessThan(20);
  });

  it('survives missing and garbage colours', () => {
    const p = derivePalette({ background: 'nope' });
    expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps very light artwork background dark', () => {
    const p = derivePalette(cases.veryLight);
    expect(contrast('#ffffff', p.bg)).toBeGreaterThan(8);
  });
});

describe('foregroundFor', () => {
  it.each(['#121212', '#2a3f5f', '#7a1f1f', '#f5f1e6', '#ffd23f', '#9bd1ff', '#888888'])('is readable on %s', (bg) => {
    const f = foregroundFor(bg);
    expect(contrast(f.text, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(f.dim, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(f.inactive, bg)).toBeGreaterThanOrEqual(3);
  });
  it('uses dark text on light backgrounds and light text on dark ones', () => {
    expect(foregroundFor('#f5f1e6').text).not.toBe('#ffffff');
    expect(foregroundFor('#121212').text).toBe('#ffffff');
  });
});
