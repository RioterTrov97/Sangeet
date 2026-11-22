/** Siri is iOS-only. Inert stand-in so shared code can import the module on Android. */
const noop = { remove() {} };
export type SiriResultCodeName = 'success' | 'failure' | 'failureNoMatch' | 'failureOffline' | 'failureUnsupported';
export default {
  ready() {},
  setVocabulary(_playlists: string[], _artists: string[]) {},
  complete(_id: string, _code: SiriResultCodeName) {},
  inject(_payload: string) {},
  addListener(_event: 'onIntent', _listener: (e: { id: string; payload: string }) => void) {
    return noop;
  },
};
