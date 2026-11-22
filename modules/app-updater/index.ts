import { requireOptionalNativeModule } from 'expo';
import type { EventSubscription } from 'expo-modules-core';

/** PackageInstaller status codes (STATUS_SUCCESS = 0). */
export type InstallResult = { status: number; message: string };

type AppUpdaterNative = {
  canInstall(): boolean;
  openInstallSettings(): void;
  /** Downloads into cacheDir/updates and resolves with the file path. Verifies SHA-256 when given (deletes the file and rejects on mismatch). */
  download(url: string, sha256: string | null, fileName: string): Promise<string>;
  /** Commits a PackageInstaller session. Resolves with the final status (on success the app is usually killed first). */
  install(path: string): Promise<InstallResult>;
  addListener(event: 'onProgress', listener: (e: { progress: number }) => void): EventSubscription;
};

/** Android-only module (Kotlin). Absent on iOS and in tests. */
export const native = requireOptionalNativeModule<AppUpdaterNative>('AppUpdater');
