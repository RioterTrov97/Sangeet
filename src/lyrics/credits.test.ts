import { isCreditLine, stripCreditsPlain, stripCreditsSynced } from './credits';

describe('credit lines', () => {
  it.each(['Lyrics by Someone', 'Music: A. R. Rahman', 'Written by Max Martin', 'Composed by X', '作词 : 某人', '作曲 : 某人', 'Lyricist - Y', 'Singer: Arijit Singh', 'Music：X', '制作人 : 某人', '混音 : 某人', '母带 : 某人', '和声 : 某人', '吉他 : 某人', '贝斯：某人', '编曲 : 某人'])('%s', (t) => expect(isCreditLine(t)).toBe(true));
  it.each(['I wrote this for you', 'Music is my life', 'Singer of songs I am', 'Lyrics are all I have', '和声', 'I miss the 鼓 sound'])('%s is a lyric', (t) => expect(isCreditLine(t)).toBe(false));
});

describe('stripCreditsPlain', () => {
  it('removes credits at the start and the end only', () => {
    const text = 'Lyrics by A\nMusic: B\n\nfirst line\nWritten by in the middle? no: Written by X\nlast line\n\nComposed by C\nSinger: D';
    expect(stripCreditsPlain(text)).toBe('first line\nWritten by in the middle? no: Written by X\nlast line');
  });
  it('keeps a credit-looking line in the middle', () => {
    expect(stripCreditsPlain('one\nMusic: x\ntwo')).toBe('one\nMusic: x\ntwo');
  });
  it('leaves normal lyrics untouched', () => {
    expect(stripCreditsPlain('a\nb\nc')).toBe('a\nb\nc');
  });
});

describe('stripCreditsSynced', () => {
  it('drops leading and trailing credit lines and keeps times', () => {
    const lines = [{ time: 0, text: 'Lyrics by A' }, { time: 1, text: 'Music: B' }, { time: 5, text: 'hello' }, { time: 9, text: 'world' }, { time: 12, text: 'Written by C' }];
    expect(stripCreditsSynced(lines)).toEqual([{ time: 5, text: 'hello' }, { time: 9, text: 'world' }]);
  });
  it('does not touch a middle line', () => {
    const lines = [{ time: 1, text: 'a' }, { time: 2, text: 'Singer: x' }, { time: 3, text: 'b' }];
    expect(stripCreditsSynced(lines)).toEqual(lines);
  });
});
