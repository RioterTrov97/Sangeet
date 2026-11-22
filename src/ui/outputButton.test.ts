import { outputIcon, outputKind } from './outputButton';

describe('outputKind', () => {
  it('shows nothing without targets', () => expect(outputKind({ airplayAvailable: false, tvsFound: 0, route: 'phone' })).toBe('none'));
  it('AirPlay only', () => expect(outputKind({ airplayAvailable: true, tvsFound: 0, route: 'phone' })).toBe('airplay'));
  it('TV only', () => expect(outputKind({ airplayAvailable: false, tvsFound: 2, route: 'phone' })).toBe('tv'));
  it('both -> unified', () => expect(outputKind({ airplayAvailable: true, tvsFound: 1, route: 'phone' })).toBe('unified'));
  it('an active TV session counts as a TV even if discovery lost it', () => {
    expect(outputKind({ airplayAvailable: false, tvsFound: 0, route: 'tv' })).toBe('tv');
    expect(outputKind({ airplayAvailable: true, tvsFound: 0, route: 'tv' })).toBe('unified');
  });
  it('an active AirPlay route counts as available', () => expect(outputKind({ airplayAvailable: false, tvsFound: 0, route: 'airplay' })).toBe('airplay'));
});

describe('outputIcon', () => {
  it('follows the route', () => {
    expect(outputIcon('unified', 'tv')).toBe('tv.fill');
    expect(outputIcon('unified', 'airplay')).toBe('airplayaudio');
    expect(outputIcon('unified', 'phone')).toBe('hifispeaker.2');
    expect(outputIcon('tv', 'phone')).toBe('tv');
    expect(outputIcon('airplay', 'phone')).toBe('airplayaudio');
  });
});
