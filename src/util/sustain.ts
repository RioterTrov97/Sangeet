import { AppState } from 'react-native';

/**
 * Turns a stream of app states into "went to background and stayed there": `handler` runs only when the state is still
 * `background` after `ms`. A momentary onPause (an intent delivered to the activity, an overlay, the Assistant) is
 * cancelled by the `active` that follows. Returns the function to feed states into, with a `cancel`.
 */
export function backgroundSustained(handler: () => void, ms = 500, current: () => string | null | undefined = () => AppState.currentState) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const feed = (state: string) => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (state !== 'background') return;
    timer = setTimeout(() => {
      timer = undefined;
      if (current() === 'background') handler();
    }, ms);
  };
  feed.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return feed;
}
