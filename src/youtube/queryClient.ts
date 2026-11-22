import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { persistQueryClientRestore, persistQueryClientSubscribe } from '@tanstack/react-query-persist-client';

import { Platform } from 'react-native';

import { storage } from '../util/storage';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60_000, gcTime: 24 * 3600_000, retry: 1 } },
});

export const queryPersister = createSyncStoragePersister({
  storage: {
    getItem: (k) => storage.getString(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => void storage.remove(k),
  },
  key: 'sangeet-query-cache',
  // Each write serialises the whole cache on the JS thread; on the TV (slow CPU) do it less often.
  throttleTime: Platform.isTV ? 15_000 : 2000,
});

/** Paged (infinite) queries hold non-serializable `next` closures, so only plain queries persist. */
export const persistOptions = {
  persister: queryPersister,
  maxAge: 24 * 3600_000,
  dehydrateOptions: {
    shouldDehydrateQuery: (q: { state: { status: string }; queryKey: readonly unknown[] }) =>
      q.state.status === 'success' && q.queryKey[0] === 'yt' && !String(q.queryKey[1]).startsWith('inf-'),
  },
};

let restored: Promise<void> | undefined;
/**
 * Hydrates the query cache from MMKV and keeps persisting it. Module-level (no React provider) so a CarPlay-only
 * launch reads the same cache as the phone UI. Memoized; resolves once the cache is hydrated.
 */
export function restoreQueryCache(): Promise<void> {
  restored ??= (async () => {
    try {
      await persistQueryClientRestore({ queryClient, ...persistOptions });
    } catch {
      /* a corrupt cache is just a cold cache */
    }
    persistQueryClientSubscribe({ queryClient, ...persistOptions });
  })();
  return restored;
}
