import { localIdFor } from './id';

export type DiskFile = { rel: string; size: number; mtime: number };
export type KnownFile = { rel: string; size: number; mtime: number };
export type ScanPlan = {
  /** Files whose tags must be (re)read: new ones and ones whose size or modification time changed. */
  read: (DiskFile & { id: string; isNew: boolean })[];
  /** Ids in the index whose file is gone. */
  remove: string[];
};

/** What a scan has to do, given the index (`known`, by id) and the files now in the music folder. Nothing when nothing changed. */
export function planScan(known: Readonly<Record<string, KnownFile>>, onDisk: readonly DiskFile[]): ScanPlan {
  const seen = new Set<string>();
  const read: ScanPlan['read'] = [];
  for (const f of onDisk) {
    const id = localIdFor(f.rel);
    seen.add(id);
    const k = known[id];
    if (!k) read.push({ ...f, id, isNew: true });
    else if (k.size !== f.size || k.mtime !== f.mtime) read.push({ ...f, id, isNew: false });
  }
  return { read, remove: Object.keys(known).filter((id) => !seen.has(id)) };
}
