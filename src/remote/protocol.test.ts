import type { Track } from '../youtube/models';
import { decode, encode, fromWire, isAllowed, isWireTrack, LineBuffer, parseAddress, PROTOCOL_VERSION, toWire } from './protocol';

const track: Track = { kind: 'track', id: 'abc', title: 'Song', artists: [{ id: 'UC1', name: 'A' }, { name: 'B' }], album: { id: 'MPRE1', name: 'Album' }, durationSec: 200, artwork: [{ url: 'file:///x.jpg' }, { url: 'https://img/1.jpg', width: 544 }] };

describe('protocol framing', () => {
  it('encodes one message per line and decodes it back', () => {
    const line = encode({ t: 'seek', sec: 12.5 });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(decode(line)).toEqual({ t: 'seek', sec: 12.5 });
  });

  it('rejects garbage and objects without a type', () => {
    expect(decode('')).toBeUndefined();
    expect(decode('not json')).toBeUndefined();
    expect(decode('{"x":1}')).toBeUndefined();
    expect(decode('[1,2]')).toBeUndefined();
    expect(decode('{"t":5}')).toBeUndefined();
  });

  it('reassembles lines split across chunks and several lines in one chunk', () => {
    const b = new LineBuffer();
    expect(b.push('{"t":"pl')).toEqual([]);
    expect(b.push('ay"}\n{"t":"pause"}\n{"t":"ne')).toEqual(['{"t":"play"}', '{"t":"pause"}']);
    expect(b.push('xt"}\n')).toEqual(['{"t":"next"}']);
  });

  it('keeps unicode titles intact', () => {
    const w = toWire({ ...track, title: 'Tum Hi Ho - तुम ही हो' });
    expect(decode(encode({ t: 'addToQueue', track: w }))).toEqual({ t: 'addToQueue', track: w });
  });
});

describe('wire tracks', () => {
  it('maps a Track to the wire shape and picks an http artwork', () => {
    expect(toWire(track)).toMatchObject({ videoId: 'abc', title: 'Song', artist: 'A, B', artwork: 'https://img/1.jpg', duration: 200 });
  });

  it('keeps the isVideo flag so the TV plays a video track as itself', () => {
    expect(fromWire(toWire({ ...track, isVideo: true })).isVideo).toBe(true);
    expect(fromWire(toWire(track)).isVideo).toBeUndefined();
  });

  it('round-trips the fields the phone UI needs', () => {
    const back = fromWire(toWire(track));
    expect(back).toMatchObject({ kind: 'track', id: 'abc', title: 'Song', durationSec: 200, album: { id: 'MPRE1', name: 'Album' } });
    expect(back.artists).toEqual([{ id: 'UC1', name: 'A' }, { name: 'B' }]);
    expect(back.artwork[0].url).toBe('https://img/1.jpg');
  });

  it('builds artists from the artist string when refs are absent', () => {
    expect(fromWire({ videoId: 'x', title: 't', artist: 'Solo', artwork: null, duration: 0 }).artists).toEqual([{ name: 'Solo' }]);
  });

  it('validates tracks', () => {
    expect(isWireTrack(toWire(track))).toBe(true);
    expect(isWireTrack({ title: 'x' })).toBe(false);
    expect(isWireTrack(null)).toBe(false);
    expect(isWireTrack({ videoId: '', title: 'x' })).toBe(false);
  });
});

describe('auth rules', () => {
  it('lets unauthenticated clients only hello/bye', () => {
    for (const t of ['hello', 'bye']) expect(isAllowed(false, t)).toBe(true);
    for (const t of ['pair', 'play', 'playQueue', 'seek', 'state', 'anything']) expect(isAllowed(false, t)).toBe(false);
    expect(isAllowed(true, 'play')).toBe(true);
  });

  it('has a protocol version', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});

describe('parseAddress', () => {
  it('adds the default port and accepts host:port', () => {
    expect(parseAddress('192.168.1.20')).toBe('192.168.1.20:8765');
    expect(parseAddress(' 127.0.0.1:9000 ')).toBe('127.0.0.1:9000');
    expect(parseAddress('tv.local')).toBe('tv.local:8765');
  });
  it('rejects junk and bad ports', () => {
    expect(parseAddress('')).toBeUndefined();
    expect(parseAddress('a b')).toBeUndefined();
    expect(parseAddress('1.2.3.4:99999')).toBeUndefined();
    expect(parseAddress('1.2.3.4:0')).toBeUndefined();
  });
});
