import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';

export type VoiceState = 'idle' | 'listening' | 'denied' | 'error';

/**
 * Voice search through iOS speech recognition (on device when the language supports it). Partial transcripts go to
 * `onPartial`; when it stops (silence or `stop()`), `onFinal` gets the last transcript. The audio session is set to mix with
 * other audio while listening and put back afterwards so music is not interrupted more than iOS requires.
 */
export function useVoiceSearch({ onPartial, onFinal }: { onPartial: (text: string) => void; onFinal: (text: string) => void }) {
  const [state, setState] = useState<VoiceState>('idle');
  const last = useRef('');
  const saved = useRef<ReturnType<typeof ExpoSpeechRecognitionModule.getAudioSessionCategoryAndOptionsIOS> | undefined>(undefined);

  const restore = () => {
    const s = saved.current;
    saved.current = undefined;
    if (s && Platform.OS === 'ios') {
      try {
        ExpoSpeechRecognitionModule.setCategoryIOS({ category: s.category, categoryOptions: s.categoryOptions, mode: s.mode });
      } catch {
        // best effort
      }
    }
  };
  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript ?? '';
    last.current = text;
    onPartial(text);
  });
  useSpeechRecognitionEvent('end', () => {
    restore();
    setState((s) => (s === 'listening' ? 'idle' : s));
    const text = last.current.trim();
    last.current = '';
    if (text) onFinal(text);
  });
  useSpeechRecognitionEvent('error', (e) => {
    restore();
    setState(e.error === 'not-allowed' ? 'denied' : e.error === 'no-speech' || e.error === 'aborted' ? 'idle' : 'error');
  });

  const start = useCallback(async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return setState('denied');
    last.current = '';
    try {
      saved.current = ExpoSpeechRecognitionModule.getAudioSessionCategoryAndOptionsIOS();
    } catch {
      saved.current = undefined;
    }
    setState('listening');
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      continuous: false,
      requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
      iosCategory: { category: 'playAndRecord', categoryOptions: ['mixWithOthers', 'allowBluetooth', 'defaultToSpeaker'], mode: 'measurement' },
    });
  }, []);
  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);
  return { state, start, stop, setState };
}
