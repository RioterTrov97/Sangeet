import { Platform } from 'react-native';

/** Words for "songs from this device": iPhone says Files and its Sangeet folder, Android its document picker. */
const android = Platform.OS === 'android';

/** "iPhone" or "phone". */
export const DEVICE = android ? 'phone' : 'iPhone';
export const ON_THIS_DEVICE = `On this ${DEVICE}`;
export const EMPTY_BODY = android ? 'Import audio files from your phone.' : 'Import audio files from Files, or drop them into On My iPhone > Sangeet > Music.';
export const FILES_NOTE = android ? 'The audio file is deleted from this phone. This cannot be undone.' : 'The audio file is deleted from this iPhone (Sangeet folder in Files). This cannot be undone.';
export const FROM_FILES = android ? 'songs from files' : 'songs from Files';
