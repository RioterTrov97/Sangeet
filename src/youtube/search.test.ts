import { parseSearchResponse } from './search';

const item = (videoId: string, title: string, runs: string[]) => ({
  musicResponsiveListItemRenderer: {
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://t/a=w60-h60-l90-rj' }] } } },
    overlay: {
      musicItemThumbnailOverlayRenderer: {
        content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId } } } },
      },
    },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: runs.map((text) => ({ text })) } } },
    ],
  },
});

describe('parseSearchResponse', () => {
  it('extracts songs from a nested response', () => {
    const json = {
      contents: { a: [{ b: item('J7p4bzqLvCw', 'Blinding Lights', ['The Weeknd', ' • ', 'After Hours', ' • ', '3:22']) }] },
    };
    expect(parseSearchResponse(json)).toEqual([
      {
        videoId: 'J7p4bzqLvCw',
        title: 'Blinding Lights',
        artist: 'The Weeknd',
        album: 'After Hours',
        durationSec: 202,
        thumbnail: 'https://t/a=w226-h226-l90-rj',
      },
    ]);
  });

  it('handles the "Song" prefix, hour-long durations and skips entries without a videoId', () => {
    const json = [
      item('x', 'Long', ['Song', ' • ', 'Artist', ' • ', 'Album', ' • ', '1:02:03']),
      { musicResponsiveListItemRenderer: { flexColumns: [] } },
    ];
    const r = parseSearchResponse(json);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ artist: 'Artist', album: 'Album', durationSec: 3723 });
  });
});
