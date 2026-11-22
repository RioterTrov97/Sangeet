import { restartsOpenVideo } from './videoFlag';

describe('starting a queue while video mode is open', () => {
  it('restarts the open video only when the queue starts on the track already showing', () => {
    expect(restartsOpenVideo(true, 'a', 'a')).toBe(true); // phone taps the song that is already playing
    expect(restartsOpenVideo(true, 'a', 'b')).toBe(false); // a different track goes through the track-changed hook
    expect(restartsOpenVideo(false, 'a', 'a')).toBe(false); // audio mode: playSong restarts it itself
    expect(restartsOpenVideo(true, undefined, 'a')).toBe(false);
  });
});
