import { isEmptyNeteaseLyric, pickNetease, type NeteaseSong } from './providers/netease';
import { parseLrc } from './lrc';
import { stripCreditsSynced } from './credits';
import type { Track } from '../youtube/models';

const track = (title: string, artist: string, dur?: number): Track => ({ kind: 'track', id: 'x', title, artists: [{ name: artist }], artwork: [], durationSec: dur });
const song = (name: string, artist: string, ms: number): NeteaseSong => ({ id: 1, name, duration: ms, artists: [{ name: artist }] });

describe('pickNetease', () => {
  it('matches title, artist and duration', () => {
    const songs = [song('Naganya Maya (Sajjan Raj Vaidya)', 'Manish Gandharva', 40800), song('Naganya Maya', 'Sajjan Raj Vaidya', 313411)];
    expect(pickNetease(songs, track('Naganya Maya', 'Sajjan Raj Vaidya', 313))?.duration).toBe(313411);
  });
  it('misses rather than guessing', () => {
    expect(pickNetease([song('Kesariya', 'Pritam', 268213)], track('Kesariya', 'Arijit Singh', 268))).toBeUndefined();
    expect(pickNetease([song('Kesariya', 'Arijit Singh', 290000)], track('Kesariya', 'Arijit Singh', 268))).toBeUndefined();
    expect(pickNetease([song('Channa Mereya', 'Arijit Singh', 289000)], track('Kesariya', 'Arijit Singh', 289))).toBeUndefined();
  });
  it('accepts a multi-artist string when the lead artist is among them', () => {
    const s: NeteaseSong = { id: 2, name: 'Kesariya', duration: 268213, artists: [{ name: 'Pritam' }, { name: 'Arijit Singh' }] };
    expect(pickNetease([s], track('Kesariya', 'Arijit Singh', 268))).toBe(s);
  });
});

describe('isEmptyNeteaseLyric', () => {
  it('detects empty and instrumental', () => {
    expect(isEmptyNeteaseLyric('')).toBe(true);
    expect(isEmptyNeteaseLyric(undefined)).toBe(true);
    expect(isEmptyNeteaseLyric('[00:00.00]纯音乐，请欣赏')).toBe(true);
    expect(isEmptyNeteaseLyric('[00:00.000] 作词 : A\n[00:01.000] 纯音乐，请欣赏')).toBe(true);
    expect(isEmptyNeteaseLyric('[00:01.00]hello\n[00:02.00]world')).toBe(false);
  });
});

describe('Chinese credit lines in NetEase LRC', () => {
  it('are stripped at the edges', () => {
    const lrc = '[00:00.000] 作词 : A\n[00:01.000] 作曲 : B\n[00:02.000] 编曲 : C\n[00:03.000] 制作人 : D\n[00:09.70]Mujhko itna\n[00:18.86]Kaise tujhse\n[03:50.00] 混音 : E\n[03:51.00] 母带 : F';
    expect(stripCreditsSynced(parseLrc(lrc).lines).map((l) => l.text)).toEqual(['Mujhko itna', 'Kaise tujhse']);
  });
});
