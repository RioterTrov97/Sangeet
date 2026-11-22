import { getJson, setJson } from '../../util/storage';

const KEY = 'dl.highAac.seen.v1';

/** True once the extractor has seen a better AAC itag (141) offered for this device/account. */
export const highQualitySeen = (): boolean => getJson<boolean>(KEY) === true;
export const noteHighQuality = (): void => {
  if (!highQualitySeen()) setJson(KEY, true);
};
