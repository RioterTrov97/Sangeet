/* eslint-disable @typescript-eslint/no-require-imports */
const mem: Record<string, string> = {};
jest.mock('../util/storage', () => ({
  getJson: (k: string) => (k in mem ? JSON.parse(mem[k]) : undefined),
  setJson: (k: string, v: unknown) => void (mem[k] = JSON.stringify(v)),
}));

describe('tvPlayer.layout persistence', () => {
  beforeEach(() => {
    jest.resetModules();
    for (const k of Object.keys(mem)) delete mem[k];
  });
  it('defaults to video on first launch', () => {
    const { useTvPlayer } = require('./playerPrefs');
    expect(useTvPlayer.getState().layout).toBe('video');
  });
  it('saves a pick and restores it on the next launch', () => {
    const a = require('./playerPrefs');
    a.setTvLayout('lyrics');
    expect(mem['tvPlayer.layout']).toBe('"lyrics"');
    jest.resetModules();
    const b = require('./playerPrefs');
    expect(b.useTvPlayer.getState().layout).toBe('lyrics');
  });
  it('ignores a corrupt saved value', () => {
    mem['tvPlayer.layout'] = '"sideways"';
    const { useTvPlayer } = require('./playerPrefs');
    expect(useTvPlayer.getState().layout).toBe('video');
  });
});
