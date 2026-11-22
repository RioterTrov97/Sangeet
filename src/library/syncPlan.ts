/**
 * Safety rules for mirroring the YouTube Music library into local rows (rules as in Metrolist's SyncUtils, reimplemented):
 *  - a list that came back empty while we hold items, or whose continuation was not followed, never deletes anything;
 *  - an item missing remotely is removed locally only if it was seen at the last successful sync (it was removed remotely),
 *    never if it was not (it was added locally since);
 *  - items the user toggled while the sync was running are left alone.
 */
export type PartInput = {
  /** Ids the remote returned. */
  remote: readonly string[];
  /** False when the part failed or a continuation was not followed (the list may be cut short). */
  complete: boolean;
  /** Ids of the local rows that came from YouTube. */
  localYt: readonly string[];
  /** Ids seen at the last successful sync; undefined before the first one (the local YouTube rows stand in for it). */
  snapshot?: readonly string[];
  /** Ids toggled locally while this sync was running. */
  touched?: ReadonlySet<string>;
};
export type PartPlan = { remove: string[]; /** Why nothing was removed although the remote lacks local items. */ skipped?: 'incomplete' | 'empty-remote'; snapshot: string[] };

export function planPart(i: PartInput): PartPlan {
  const touched = i.touched ?? new Set<string>();
  const known = i.snapshot ?? i.localYt;
  if (!i.complete) return { remove: [], skipped: 'incomplete', snapshot: union(known, i.remote) };
  if (i.remote.length === 0 && i.localYt.length > 0) return { remove: [], skipped: 'empty-remote', snapshot: [...known] };
  const remote = new Set(i.remote);
  const was = new Set(known);
  const remove = i.localYt.filter((id) => !remote.has(id) && was.has(id) && !touched.has(id));
  return { remove, snapshot: [...i.remote] };
}

const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])];
