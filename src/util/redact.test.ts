import { formatLine, parseLine } from './logFile';
import { redact } from './redact';

describe('redact', () => {
  it('hides Authorization headers and bearer tokens', () => {
    expect(redact('Authorization: Bearer abc123def456ghi')).not.toMatch(/abc123/);
    expect(redact('sent Bearer abcdefgh12345678 ok')).toBe('sent Bearer [redacted] ok');
    expect(redact('Authorization: SAPISIDHASH 1700_deadbeef')).not.toMatch(/deadbeef/);
  });
  it('hides cookies', () => {
    const out = redact('Cookie: SAPISID=secretvalue; __Secure-3PSID=other; foo=bar');
    expect(out).not.toMatch(/secretvalue|other/);
    expect(redact('got SAPISID=zzz123 and HSID=yyy789')).not.toMatch(/zzz123|yyy789/);
  });
  it('hides tokens in JSON and query strings', () => {
    expect(redact('{"token":"s3cr3t-value","a":1}')).not.toMatch(/s3cr3t/);
    expect(redact('GET /x?pot=AbCdEf&sig=XyZ123&id=1')).toBe('GET /x?pot=[redacted]&sig=[redacted]&id=1');
    expect(redact('poToken=MnQ_abc')).not.toMatch(/MnQ_abc/);
  });
  it('leaves ordinary lines alone', () => {
    const line = '[resolver] resolved dQw4w9WgXcQ in 812ms itag=140';
    expect(redact(line)).toBe(line);
  });
});

describe('log line format', () => {
  it('round-trips and keeps one line per entry', () => {
    const e = parseLine(formatLine('W', 'resolver', 'a\nb').trimEnd());
    expect(e).toMatchObject({ level: 'W', tag: 'resolver' });
    expect(e!.msg).not.toMatch(/\n/);
  });
});
