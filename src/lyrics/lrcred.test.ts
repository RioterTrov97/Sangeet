import { pickLrcRed, type LrcRedHit } from './providers/lrcred';
import type { Track } from '../youtube/models';

const track = (title: string, artist: string, dur?: number): Track => ({ kind: 'track', id: 'x', title, artists: [{ name: artist }], artwork: [], durationSec: dur });
const hit = (track_name: string, artist_name: string, duration: number, timing_type = 'line'): LrcRedHit => ({ track_name, artist_name, duration, timing_type, lyricsUrl: `https://lrc.red/s/${track_name}.ttml` });

describe('pickLrcRed (strict)', () => {
  it('rejects the artist catalogue when the title differs (Kesariya search lists Channa Mereya)', () => {
    expect(pickLrcRed([hit('Channa Mereya', 'Arijit Singh', 289)], track('Kesariya', 'Arijit Singh', 289))).toBeUndefined();
  });
  it('matches titles with film tags and multi-artist strings', () => {
    const r = pickLrcRed([hit('Kesariya (From "Brahmastra")', 'Pritam, Arijit Singh, Amitabh Bhattacharya', 268, 'word')], track('Kesariya - Official Video', 'Arijit Singh', 267));
    expect(r?.track_name).toContain('Kesariya');
  });
  it('requires the lead artist', () => {
    expect(pickLrcRed([hit('Naganya Maya', 'Prason Bista', 313)], track('Naganya Maya', 'Sajjan Raj Vaidya', 313))).toBeUndefined();
  });
  it('requires duration within 5 s, preferring 2 s', () => {
    const t = track('Song', 'Artist', 200);
    expect(pickLrcRed([hit('Song', 'Artist', 210)], t)).toBeUndefined();
    expect(pickLrcRed([hit('Song', 'Artist', 204), hit('Song', 'Artist', 201)], t)?.duration).toBe(201);
    expect(pickLrcRed([hit('Song', 'Artist', 204)], t)?.duration).toBe(204);
  });
  it('skips untimed hits and prefers word timing', () => {
    const t = track('Song', 'Artist', 200);
    expect(pickLrcRed([hit('Song', 'Artist', 200, 'none')], t)).toBeUndefined();
    expect(pickLrcRed([hit('Song', 'Artist', 200, 'line'), hit('Song', 'Artist', 200, 'word')], t)?.timing_type).toBe('word');
  });
});
