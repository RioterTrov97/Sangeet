export * from '../player/layout';

/** Track-grid columns for a content width in dp: 2, or 3 when each column would still be at least 420 px wide on the real screen. */
export function gridColumns(widthDp: number, pixelRatio: number): number {
  return (widthDp * pixelRatio) / 3 >= 420 ? 3 : 2;
}

/** Video frame inside the Video + Lyrics side box: 16:9, full box width, shrunk (and centred) so a meta row of `metaH` always fits below it. */
export function sideVideoSize(boxW: number, boxH: number, metaH: number): { width: number; height: number } {
  const h = Math.max(0, Math.min((boxW * 9) / 16, boxH - metaH));
  return { width: Math.round((h * 16) / 9), height: Math.round(h) };
}
