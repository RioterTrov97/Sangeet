import { buildQueueRows, sourceLabel } from './QueueSheet';
import type { Track } from '../youtube/models';
jest.mock('../../modules/stream-proxy', () => ({ __esModule: true, default: {} }));
jest.mock('../util/storage', () => ({ getJson: () => undefined, setJson: () => {} }));
jest.mock('../player', () => ({}));
jest.mock('@gorhom/bottom-sheet', () => ({}));
jest.mock('react-native-draggable-flatlist', () => ({}));
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({}));
jest.mock('react-native-unistyles', () => ({ StyleSheet: { create: () => ({}) }, useUnistyles: () => ({}) }));
jest.mock('expo-symbols', () => ({}));
jest.mock('expo-image', () => ({}));
jest.mock('./Artwork', () => ({}));
jest.mock('./Equalizer', () => ({}));
jest.mock('./palette/store', () => ({ usePalette: () => ({ bgDeep: '#000' }) }));

const t = (id: string): Track => ({ kind: 'track', id, title: id, artists: [], artwork: [] });

describe('queue sections', () => {
  it('splits user-added from source tracks and skips the current one', () => {
    const rows = buildQueueRows([t('a'), t('b'), t('c'), t('d')], 0, ['c'], 'album:x', 'Blonde');
    expect(rows.map((r) => (r.type === 'header' ? r.title : r.track.id))).toEqual(['Next in queue', 'c', 'Next from: Blonde', 'b', 'd']);
  });
  it('labels sources', () => {
    expect(sourceLabel('search')).toBe('Search');
    expect(sourceLabel('album:1', 'X')).toBe('X');
  });
});
