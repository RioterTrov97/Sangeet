import { create } from 'zustand';

import { perfStart } from '../util/perf';

export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'library' }
  | { name: 'now' }
  | { name: 'settings' }
  | { name: 'album'; id: string }
  | { name: 'playlist'; id: string }
  | { name: 'artist'; id: string }
  | { name: 'liked' }
  | { name: 'mood'; params: string; title: string };

type NavState = { stack: Route[]; push: (r: Route) => void; pop: () => boolean; root: (r: Route) => void };

/**
 * Called (synchronously, before the stack changes) when the user navigates away from Now Playing, so the video can be handed
 * back to audio at that moment instead of from the unmount cleanup, which only runs after the next screen has been built.
 */
let beforeLeaveNow: (() => void) | undefined;
export const setBeforeLeaveNow = (f: (() => void) | undefined): void => void (beforeLeaveNow = f);
/** Called with the root's name when the visible root screen is about to be hidden (covered by a pushed screen or replaced by another root): it remembers its focus. */
let beforeLeaveRoot: ((name: string) => void) | undefined;
export const setBeforeLeaveRoot = (f: ((name: string) => void) | undefined): void => void (beforeLeaveRoot = f);
/** Called with the root's name just before it becomes the visible screen again (Back from a pushed screen, rail choice): it claims its remembered focus in the same render that shows it. */
let beforeShowRoot: ((name: string) => void) | undefined;
export const setBeforeShowRoot = (f: ((name: string) => void) | undefined): void => void (beforeShowRoot = f);
const leavingRoot = (stack: Route[]) => stack.length === 1 && beforeLeaveRoot?.(stack[0].name);
const leavingNow = (stack: Route[]) => stack[stack.length - 1].name === 'now' && beforeLeaveNow?.();

/** Tiny stack navigator for the TV app: a root screen (the rail destination) plus pushed detail screens. */
export const useTvNav = create<NavState>((set, get) => ({
  stack: [{ name: 'home' }],
  push: (r) => (leavingRoot(get().stack), leavingNow(get().stack), perfStart('nav'), set({ stack: [...get().stack, r] })),
  pop: () => {
    if (get().stack.length <= 1) return false;
    leavingNow(get().stack);
    if (get().stack.length === 2) beforeShowRoot?.(get().stack[0].name);
    set({ stack: get().stack.slice(0, -1) });
    return true;
  },
  root: (r) => (leavingRoot(get().stack), leavingNow(get().stack), beforeShowRoot?.(r.name), perfStart('nav'), set({ stack: [r] })),
}));

export const tvNav = () => useTvNav.getState();
