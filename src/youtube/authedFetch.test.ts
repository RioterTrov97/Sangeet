import { authedFetch } from './authedFetch';

describe('authedFetch', () => {
  const call = async (headers: Record<string, string>) => {
    const base = jest.fn(async (_i: unknown, _init?: RequestInit) => new Response('{}'));
    await authedFetch(base as unknown as typeof fetch)('https://www.youtube.com/youtubei/v1/browse', { method: 'POST', headers });
    const init = base.mock.calls[0][1]!;
    return { headers: new Headers(init.headers), credentials: init.credentials };
  };

  it('adds the origin SAPISIDHASH is signed with and omits the shared cookie store', async () => {
    const r = await call({ Authorization: 'SAPISIDHASH 1_abc', Cookie: 'SAPISID=x' });
    expect(r.headers.get('Origin')).toBe('https://www.youtube.com');
    expect(r.headers.get('X-Origin')).toBe('https://www.youtube.com');
    expect(r.headers.get('Cookie')).toBe('SAPISID=x');
    expect(r.credentials).toBe('omit');
  });

  it('leaves unsigned requests and an existing Origin alone', async () => {
    expect((await call({})).headers.has('Origin')).toBe(false);
    expect((await call({ Authorization: 'x', Origin: 'https://music.youtube.com' })).headers.get('Origin')).toBe('https://music.youtube.com');
  });
});
