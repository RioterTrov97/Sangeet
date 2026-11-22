import * as DocumentPicker from 'expo-document-picker';

import { log, logWarn } from '../util/log';
import { showNotice } from '../util/notice';
import { importFiles } from './index';

const plural = (n: number) => `${n} song${n === 1 ? '' : 's'}`;

/** Opens the Files picker (On My iPhone, iCloud Drive, USB drives, ...) for audio files and copies the picked ones into the Sangeet music folder. */
let busy = false;
/** A second tap while the picker is opening or the import runs is ignored (the native picker rejects a second open). */
export async function importSongsFromFiles(): Promise<void> {
  if (busy) return log('local', 'import already in progress; tap ignored');
  log('local', 'opening the Files picker');
  busy = true;
  try {
    await pickAndImport();
  } finally {
    busy = false;
  }
}

async function pickAndImport(): Promise<void> {
  let r: DocumentPicker.DocumentPickerResult;
  try {
    r = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
  } catch (e) {
    logWarn('local', 'file picker failed', describe(e));
    return showNotice(`Couldn't open those files: ${short(e)}`, 8000);
  }
  if (r.canceled || !r.assets?.length) return;
  log('local', `picked ${r.assets.length} file(s): ${r.assets.map((a) => `${a.name} (${a.size ?? '?'} B)`).join(', ')}`);
  try {
    const { added, skipped } = await importFiles(r.assets.map((a) => ({ name: a.name, uri: a.uri })));
    const parts = [added ? `Added ${plural(added)}` : 'No new songs added'];
    if (skipped) parts.push(`${skipped} file${skipped === 1 ? '' : 's'} skipped`);
    showNotice(parts.join(' · '));
  } catch (e) {
    logWarn('local', 'import failed', describe(e));
    showNotice(`Couldn't import those files: ${short(e)}`, 8000);
  }
}

const describe = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}${(e as { code?: string }).code ? ` [${(e as { code?: string }).code}]` : ''}` : String(e));
const short = (e: unknown): string => describe(e).slice(0, 120);
