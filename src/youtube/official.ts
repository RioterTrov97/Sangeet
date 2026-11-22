import type { MusicItem } from './models';

/**
 * Official first: other people's uploads (YouTube Music's UGC label: covers, fan videos, re-uploads) are dropped from a
 * list whenever it also has official tracks (songs or the artists' own videos). A list of only uploads is left as is,
 * so obscure things that exist only as uploads still show.
 */
export function preferOfficial<T extends MusicItem>(items: T[]): T[] {
  const isUpload = (i: MusicItem) => i.kind === 'track' && i.videoType === 'ugc';
  const hasOfficial = items.some((i) => i.kind === 'track' && i.videoType && i.videoType !== 'ugc');
  return hasOfficial ? items.filter((i) => !isUpload(i)) : items;
}
