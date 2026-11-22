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

  it('only emits the update feed override in screenshot builds', () => {
    const saved = { feed: process.env.SANGEET_UPDATE_FEED, shots: process.env.SANGEET_SCREENSHOTS };
    process.env.SANGEET_UPDATE_FEED = 'http://127.0.0.1:8099/releases';
    delete process.env.SANGEET_SCREENSHOTS;
    expect((load().extra as { updateFeed?: string }).updateFeed).toBeUndefined();
    process.env.SANGEET_SCREENSHOTS = '1';
    expect((load().extra as { updateFeed?: string }).updateFeed).toBe('http://127.0.0.1:8099/releases');
    if (saved.feed === undefined) delete process.env.SANGEET_UPDATE_FEED;
    else process.env.SANGEET_UPDATE_FEED = saved.feed;
    if (saved.shots === undefined) delete process.env.SANGEET_SCREENSHOTS;
    else process.env.SANGEET_SCREENSHOTS = saved.shots;
  });

  it('has Android Auto on by default and off with SANGEET_ANDROID_AUTO=0', () => {
    const saved = process.env.SANGEET_ANDROID_AUTO;
    delete process.env.SANGEET_ANDROID_AUTO;
    expect((load().extra as { androidAuto?: boolean }).androidAuto).toBe(true);
    process.env.SANGEET_ANDROID_AUTO = '0';
    expect((load().extra as { androidAuto?: boolean }).androidAuto).toBe(false);
    if (saved === undefined) delete process.env.SANGEET_ANDROID_AUTO;
    else process.env.SANGEET_ANDROID_AUTO = saved;
  });
});
