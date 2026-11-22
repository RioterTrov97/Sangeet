import { playerState } from '../player/store';
import { clearStarting, markStarting, useHostUi } from '../remote/hostUi';
import { playMusicLink } from '../link/playLink';
import { log, logWarn } from '../util/log';
import { noteRemoteWake } from './activity';
import { parseMusicLink } from './musicLink';
import { tvNav } from './nav';

const FROM = 'YouTube Music';

const toast = (text: string) => useHostUi.setState({ toast: { text, id: Date.now() } });
const showNow = () => {
  const nav = tvNav();
  if (nav.stack[nav.stack.length - 1].name !== 'now') nav.root({ name: 'now' });
};

/**
 * Opens a YouTube Music link: songs, albums and playlists play at once on Now Playing ("Starting playback from YouTube
 * Music…" while loading); an artist link opens the artist page. Anything else shows a short notice.
 */
export function openMusicLink(url: string): void {
  const link = parseMusicLink(url);
  log('link', `open ${url} -> ${link ? JSON.stringify(link) : 'not playable'}`);
  if (!link) return toast("Sangeet can't open that link");
  if (link.kind === 'artist') return void tvNav().push({ name: 'artist', id: link.id });
  // The activity may be coming forward from the background: that AppState churn must not pause the new playback.
  noteRemoteWake();
  const before = playerState().queue[playerState().index]?.id;
  markStarting(FROM);
  showNow();
  playMusicLink(link)
    .then(() => toast(`Playing from ${FROM}`))
    .catch((e) => {
      logWarn('link', `could not play ${url}`, e instanceof Error ? e.message : e);
      clearStarting();
      // Nothing new started: say so (the previous song, if any, is still loaded).
      if (playerState().queue[playerState().index]?.id === before) toast("Couldn't play that YouTube Music link");
    });
}
