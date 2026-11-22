import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { getJson, setJson } from '../../util/storage';

const URL_KEY = 'server.url.v1';
const TOKEN_KEY = 'sangeet.server.token';
const FLAG_KEY = 'server.forceOnly.v1';

type State = { url: string; token: string; hasToken: boolean; forceServerOnly: boolean; loaded: boolean };
export const useServerConfig = create<State>(() => ({ url: getJson<string>(URL_KEY) ?? '', token: '', hasToken: false, forceServerOnly: getJson<boolean>(FLAG_KEY) ?? false, loaded: false }));

/** Cleans what the user typed: trims, drops a trailing slash, adds http:// when no scheme was given. */
export function normalizeServerUrl(input: string): string {
  const t = input.trim().replace(/\/+$/, '');
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `http://${t}`;
}

export const serverConfig = () => useServerConfig.getState();
export const serverConfigured = () => !!serverConfig().url && !!serverConfig().token;

export async function loadServerConfig(): Promise<void> {
  try {
    const token = (await SecureStore.getItemAsync(TOKEN_KEY)) ?? '';
    useServerConfig.setState({ token, hasToken: !!token, loaded: true });
  } catch {
    useServerConfig.setState({ loaded: true });
  }
}

export async function saveServerConfig(url: string, token: string): Promise<void> {
  const clean = normalizeServerUrl(url);
  setJson(URL_KEY, clean);
  useServerConfig.setState({ url: clean });
  if (token) {
    await SecureStore.setItemAsync(TOKEN_KEY, token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
    useServerConfig.setState({ token, hasToken: true });
  }
  if (!clean) await clearServerToken();
}

export async function clearServerToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  useServerConfig.setState({ token: '', hasToken: false });
}

/** Dev flag: skip the on-device resolver entirely so only the backup server is exercised. */
export function setForceServerOnly(v: boolean): void {
  setJson(FLAG_KEY, v);
  useServerConfig.setState({ forceServerOnly: v });
}
