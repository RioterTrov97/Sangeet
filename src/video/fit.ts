/**
 * Full-screen video picture mode. `fill` covers the whole screen (edges cropped), `fit` shows the whole frame (black bars),
 * `auto` fills unless that would crop away more than MAX_AUTO_CROP of the picture (a 4:3 or square video fits instead).
 */
export type VideoFitPref = 'auto' | 'fill' | 'fit';

/** Share of the picture `auto` may crop to fill the screen: a 16:9 video on a ~19.5:9 phone loses ~18% and fills; 4:3 would lose ~38% and fits. */
export const MAX_AUTO_CROP = 0.25;

/** Share of the picture cut off when a `video`-shaped frame covers a `screen`-shaped one (0 = same shape). */
export function coverCrop(videoW: number, videoH: number, screenW: number, screenH: number): number {
  if (videoW <= 0 || videoH <= 0 || screenW <= 0 || screenH <= 0) return 0;
  const v = videoW / videoH;
  const s = screenW / screenH;
  return 1 - Math.min(v, s) / Math.max(v, s);
}

/** The picture mode to draw: an explicit choice wins; `auto` fills unless the crop is too big (unknown size fills). */
export function resolveFit(pref: VideoFitPref, video: { width: number; height: number } | undefined, screenW: number, screenH: number): 'fill' | 'fit' {
  if (pref !== 'auto') return pref;
  if (!video) return 'fill';
  return coverCrop(video.width, video.height, screenW, screenH) > MAX_AUTO_CROP ? 'fit' : 'fill';
}

/** Tap order of the picture-mode button. */
export const nextFit = (f: VideoFitPref): VideoFitPref => (f === 'auto' ? 'fill' : f === 'fill' ? 'fit' : 'auto');
