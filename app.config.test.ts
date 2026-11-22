/** @jest-environment node */
describe('app config build flags', () => {
  const load = () => {
    let cfg: { extra?: { screenshots?: boolean } } = {};
    jest.isolateModules(() => {
      cfg = (require('./app.config') as { default: typeof cfg }).default;
    });
    return cfg;
  };
  const saved = process.env.SANGEET_SCREENSHOTS;
  afterEach(() => {
    if (saved === undefined) delete process.env.SANGEET_SCREENSHOTS;
    else process.env.SANGEET_SCREENSHOTS = saved;
  });

  it('keeps the screenshot driver off by default (TestFlight builds)', () => {
    delete process.env.SANGEET_SCREENSHOTS;
    expect(load().extra?.screenshots).toBe(false);
  });

  it('turns it on only with SANGEET_SCREENSHOTS=1', () => {
    process.env.SANGEET_SCREENSHOTS = '1';
    expect(load().extra?.screenshots).toBe(true);
  });
});
