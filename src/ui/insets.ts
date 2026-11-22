import { layout } from './theme';

/**
 * How a screen treats the top of the display:
 * - safe: container is padded by the status-bar inset (tab pages with an in-flow title)
 * - under: not padded; scrolling content starts below the status bar but may scroll beneath it
 * - header: a floating <Header> bar occupies inset + bar height; content starts below it
 * - none: full-bleed hero; the screen positions its own overlay controls
 * - sheet: presented as a card sheet, which already starts below the status bar
 */
export type TopMode = 'safe' | 'under' | 'header' | 'none' | 'sheet';

/** Padding the screen container itself must apply. */
export function containerTop(mode: TopMode, safeTop: number): number {
  if (mode === 'safe') return safeTop;
  if (mode === 'sheet') return layout.sheetTop;
  return 0;
}

/** Offset scrolling content must reserve at its top (for modes where the container does not pad). */
export function contentTop(mode: TopMode, safeTop: number): number {
  if (mode === 'under') return safeTop;
  if (mode === 'header') return safeTop + layout.headerBar;
  return 0;
}

/** A modal presented full-screen (not as a card sheet) needs the real status-bar inset. */
export function sheetTopInset(fullScreen: boolean, safeTop: number): number {
  return fullScreen ? safeTop + layout.heroGap : layout.sheetTop;
}
