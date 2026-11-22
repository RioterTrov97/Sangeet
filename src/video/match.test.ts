import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeArtist, normalizeTitle } from '../lyrics/normalize';
import { pickVideoMatch } from './logic';
import { artistOverlap, durationFactor, hasBadMarker, mergeCandidates, rankVideoCandidates, titleSim, type MatchSong, type Scored, type VideoCandidate } from './match';

type FixCand = Omit<VideoCandidate, 'source'>;
type FixSong = { id: string; song: MatchSong & { id: string; videoType?: string }; layers: FixCand[][]; gt: { good: string[]; ok: string[] } };
type Fixture = { songs: FixSong[]; verify: Record<string, { type: 'official' | 'ugc' | 'song' | 'plain' | 'unknown'; artists: string[] }> };

const fixture: Fixture = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'videoMatch.json'), 'utf8'));
const SOURCES = ['ytm', 'web', 'web'] as const;

/** The chain of the app, offline: layers add candidates (YTM search, web search, web "music video" search), a pick that came only from the web is verified with the saved `/next` result. */
function runChain(s: FixSong, allowLyric = true): { pick?: Scored; verifies: number } {
  const pools: VideoCandidate[][] = [];
  const meta = new Map<string, { videoType: VideoCandidate['videoType']; artists: { name: string }[] }>();
  let verifies = 0;
  let best: Scored | undefined;
  for (let i = 0; i < s.layers.length; i++) {
    pools.push(
      s.layers[i].map((c) => ({
        ...c,
        source: SOURCES[i],
        ...(i === 0 ? { artists: (c.channel?.name ?? '').split(', ').map((name) => ({ name })) } : {}),
      })),
    );
    for (;;) {
      const merged = mergeCandidates(pools).map((c) => (meta.has(c.id) ? { ...c, ...meta.get(c.id) } : c));
      best = rankVideoCandidates(s.song, merged, { allowLyric }).best;
      if (!best || !best.needsVerify || meta.has(best.id)) break;
      const info = fixture.verify[best.id];
      if (!info) throw new Error(`fixture has no verify data for ${best.id} (${s.id})`);
      verifies++;
      meta.set(best.id, { videoType: info.type === 'unknown' ? 'plain' : info.type, artists: info.artists.map((name) => ({ name })) });
    }
    if (best?.tier === 'A') break;
  }
  return { pick: best, verifies };
}

const judge = (s: FixSong, id: string | undefined | null) => (!id ? 'none' : s.gt.good.includes(id) ? 'good' : s.gt.ok.includes(id) ? 'ok' : 'wrong');

describe('fixture: 66 songs', () => {
  const results = fixture.songs.map((s) => ({ s, ...runChain(s) }));
  const tally = { hit: 0, wrong: 0, none: 0 };
  for (const r of results) {
    const j = judge(r.s, r.pick?.id);
    if (j === 'good' || j === 'ok') tally.hit++;
    else if (j === 'wrong') tally.wrong++;
    else tally.none++;
  }
  // The same fixture through the matcher this replaces (YTM "Videos" pool only, as the app fed it).
  const old = { hit: 0, wrong: 0, none: 0 };
  for (const s of fixture.songs) {
    const cands = s.layers[0].map((c) => ({ id: c.id, title: c.title, artists: (c.channel?.name ?? '').split(', ').map((name) => ({ name })), durationSec: c.durationSec, videoType: c.videoType, views: c.views }));
    const j = judge(s, pickVideoMatch(s.song, cands, normalizeTitle, normalizeArtist));
    if (j === 'good' || j === 'ok') old.hit++;
    else if (j === 'wrong') old.wrong++;
    else old.none++;
  }
  const withVideo = fixture.songs.filter((s) => s.gt.good.length).length;
  console.log(`video match, ${fixture.songs.length} songs (${withVideo} with a video): new ${JSON.stringify(tally)}, old pickVideoMatch ${JSON.stringify(old)}`);

  it('has no wrong video and at least 52 hits', () => {
    expect(tally.wrong).toBe(0);
    expect(tally.hit).toBeGreaterThanOrEqual(52);
  });
  it('beats the old matcher on the same fixture', () => {
    expect(tally.hit).toBeGreaterThan(old.hit);
    expect(tally.wrong).toBeLessThan(old.wrong);
  });
  it('uses at most one verify call per song on average', () => {
    expect(results.reduce((n, r) => n + r.verifies, 0) / results.length).toBeLessThan(0.5);
  });
});

describe('named regression cases', () => {
  const byId = (id: string) => fixture.songs.find((x) => x.id === id)!;
  const pickOf = (id: string) => runChain(byId(id)).pick;
  const isHit = (id: string) => ['good', 'ok'].includes(judge(byId(id), pickOf(id)?.id));

  it('N01 Rukum Maikot: the film label video that YouTube Music search does not return', () => {
    expect(pickOf('N01')?.id).toBe('p7wDS1VV3n4');
  });
  it('N05 Mata Laliguras Bhaye vs "Ma Ta Lali Gurans": romanisation variants', () => expect(isHit('N05')).toBe(true));
  it('H08 Kahani Suno 2.0 vs "Kahani Suno"', () => expect(isHit('H08')).toBe(true));
  it('E07 Take Me to Church: the 1B-view video, not the 20k-view audio-as-video', () => {
    expect(isHit('E07')).toBe(true);
    expect(pickOf('E07')?.id).not.toBe('1u8vnU0iKkA');
  });
  it('E08 Anti-Hero: video 109 s longer than the song', () => expect(isHit('E08')).toBe(true));
  it('Q01 Apna Bana Le: film cut 57 s shorter, never the lofi mix', () => {
    expect(isHit('Q01')).toBe(true);
    expect(pickOf('Q01')?.tier).toBe('A');
  });
  it('X02 "AI mix" gets no video (artist-overlap rejects the real Rukum Maikot video)', () => {
    expect(pickOf('X02')).toBeUndefined();
    const s = byId('X02');
    const all = mergeCandidates(s.layers.map((l, i) => l.map((c) => ({ ...c, source: SOURCES[i] }))));
    expect(rankVideoCandidates(s.song, all).ranked.every((c) => c.tier !== 'A')).toBe(true);
  });
  it('X06 lofi flip matches the lofi video', () => expect(pickOf('X06')?.id).toBe('sFxzbZaGU_g'));
  it('X07 Kesariya (Dance Mix) matches the dance mix video, not the film version', () => expect(pickOf('X07')?.id).toBe('K3B8-klo5xc'));
});

describe('titleSim', () => {
  it('matches romanisation variants through the skeleton', () => {
    expect(titleSim('Eakchhina Timi (Anju Pant)', 'Ekai Chhin Timi (Anju Panta)')).toBeGreaterThanOrEqual(0.7);
    expect(titleSim('Mata Laliguras Bhaye', 'Ma Ta Laliguras Bhayechu | Narayan Gopal | Kshetra Pratap Adhikari | Nepali Song')).toBeGreaterThanOrEqual(0.7);
  });
  it('compares every | and - segment of the video title', () => {
    expect(titleSim('Tere Vaaste', 'Zara Hatke Zara Bachke | Tere Vaaste | Vicky Kaushal, Sara Ali Khan')).toBeGreaterThanOrEqual(0.9);
    expect(titleSim('Chaiyya Chaiyya', 'Dil Se - Chaiyya Chaiyya (Full Video)')).toBeGreaterThanOrEqual(0.9);
  });
  it('tolerates a version suffix', () => expect(titleSim('Kahani Suno 2.0', 'Kahani Suno')).toBeGreaterThanOrEqual(0.7));
  it('rejects different songs', () => {
    expect(titleSim('Kesariya', 'Tum Hi Ho')).toBeLessThan(0.5);
    expect(titleSim('Shape of You', 'Shape of My Heart')).toBeLessThan(0.7);
  });
});

describe('duration windows', () => {
  it('accepts -8..+90 s fully', () => {
    expect([-8, 0, 45, 90].map((d) => durationFactor(d))).toEqual([1, 1, 1, 1]);
  });
  it('accepts +90..+130 s and -20..-8 s at reduced weight', () => {
    expect(durationFactor(109)).toBe(0.6);
    expect(durationFactor(-15)).toBe(0.5);
  });
  it('rejects film cuts and long edits unless official/verified with 2M views', () => {
    expect(durationFactor(-57)).toBe(0);
    expect(durationFactor(-57, true)).toBe(0.6);
    expect(durationFactor(-141, true)).toBe(0);
    expect(durationFactor(131, true)).toBe(0);
    expect(durationFactor(200)).toBe(0);
  });
});

describe('marker words', () => {
  it('rejects derivatives of a plain song', () => {
    for (const t of ['Song (Live at X)', 'Song - Cover', 'Song lofi flip', 'The Making of Song', 'Song (Slowed + Reverb)', 'Song | Karaoke']) expect(hasBadMarker('Song', t)).toBe(true);
  });
  it('accepts a plain video of a plain song', () => expect(hasBadMarker('Song', 'Song (Official Video)')).toBe(false));
  it('does not count markers inside the song title itself', () => expect(hasBadMarker('Live Forever', 'Live Forever - Official Video')).toBe(false));
  it('a song with a marker only matches candidates with the same marker', () => {
    expect(hasBadMarker('Kesariya (Dance Mix)', 'Kesariya (Dance Mix) | Official Video')).toBe(false);
    expect(hasBadMarker('Kesariya (Dance Mix)', 'Kesariya - Film Version')).toBe(true);
    expect(hasBadMarker('Song (Lofi Flip)', 'Song (Lofi Flip) | Official')).toBe(false);
  });
});

describe('artist overlap', () => {
  const tadha: MatchSong = { title: 'Tadha', artists: [{ name: 'Yabesh Thapa' }], durationSec: 240 };
  it('needs a shared name between the video artists and the song artists / feat credits', () => {
    expect(artistOverlap(tadha, ['Sugam Pokharel'])).toBe(false);
    expect(artistOverlap(tadha, ['Yabesh Thapa'])).toBe(true);
    expect(artistOverlap({ title: 'Rukum Maikot (feat. SD Yogi & Shanti Shree Pariyar)', artists: [{ name: 'Ashok Thapa Magar' }] }, ['Kendra Motion Pictures', 'SD Yogi'])).toBe(true);
  });
  const cand = (artists?: string[]): VideoCandidate => ({ id: 'v1', title: 'Tadha', channel: { name: 'Music Nepal', verified: true }, durationSec: 240, views: 3_000_000, source: 'web', videoType: artists ? 'ugc' : undefined, artists: artists?.map((name) => ({ name })) });
  it('Tadha by another artist is not tier A', () => {
    expect(rankVideoCandidates(tadha, [cand(['Sugam Pokharel'])]).best).toBeUndefined();
  });
  it('Tadha by the right artist is tier A', () => {
    expect(rankVideoCandidates(tadha, [cand(['Yabesh Thapa'])]).best?.tier).toBe('A');
  });
  it('without an artist list the pick stays A but needs a verify', () => {
    const r = rankVideoCandidates(tadha, [cand()]).best;
    expect(r?.tier).toBe('A');
    expect(r?.needsVerify).toBe(true);
  });
  it('a YouTube Music "song" (audio track) is never a video', () => {
    expect(rankVideoCandidates(tadha, [{ ...cand(['Yabesh Thapa']), videoType: 'song' }]).ranked).toEqual([]);
  });
});

describe('mergeCandidates', () => {
  it('keeps the YTM type and artists, the verified flag and the larger view count', () => {
    const [m] = mergeCandidates([
      [{ id: 'a', title: 'T', channel: { name: 'X' }, views: 10, videoType: 'official', artists: [{ name: 'X' }], source: 'ytm' }],
      [{ id: 'a', title: 'T (Official Video)', channel: { name: 'X', verified: true }, views: 900, durationSec: 200, source: 'web' }],
    ]);
    expect(m).toMatchObject({ id: 'a', videoType: 'official', views: 900, durationSec: 200, source: 'ytm', channel: { name: 'X', verified: true } });
    expect(m.artists).toEqual([{ name: 'X' }]);
  });
});
