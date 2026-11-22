import { createMMKV } from 'react-native-mmkv';

/** App-wide key-value store (query cache, queue, recent searches). */
export const storage = createMMKV({ id: 'sangeet' });

export function getJson<T>(key: string): T | undefined {
  try {
    const raw = storage.getString(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function setJson(key: string, value: unknown): void {
  storage.set(key, JSON.stringify(value));
}
