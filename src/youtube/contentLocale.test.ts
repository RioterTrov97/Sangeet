import { localeSessionOptions, onContentLocaleChange, sanitizeLocale, setContentLocale, useContentLocale } from './contentLocale';

jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: jest.fn() }));

describe('content locale', () => {
  beforeEach(() => useContentLocale.setState({ lang: undefined, region: undefined }, true));
  it('System default adds nothing to the session options', () => expect(localeSessionOptions({})).toEqual({}));
  it('maps language and region to hl / gl options', () => expect(localeSessionOptions({ lang: 'ne', region: 'NP' })).toEqual({ lang: 'ne', location: 'NP' }));
  it('drops values that are not offered', () => expect(sanitizeLocale({ lang: 'xx', region: 'NP' })).toEqual({ lang: undefined, region: 'NP' }));
  it('notifies listeners only when something changed', () => {
    const fn = jest.fn();
    const off = onContentLocaleChange(fn);
    setContentLocale({ region: 'IN' });
    setContentLocale({ region: 'IN' });
    setContentLocale({ lang: 'hi' });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(useContentLocale.getState()).toEqual({ lang: 'hi', region: 'IN' });
    setContentLocale({ region: undefined });
    expect(useContentLocale.getState().region).toBeUndefined();
    off();
  });
});
