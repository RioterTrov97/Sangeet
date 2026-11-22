import { create } from 'zustand';

/** Last resolved audio format per video id ("AAC 128 kbps (itag 140)"), shown in Settings for the current track. */
export const useStreamInfo = create<{ byId: Record<string, string>; set: (id: string, label: string) => void }>((set) => ({
  byId: {},
  set: (id, label) =>
    set((s) => {
      const keys = Object.keys(s.byId);
      const byId = keys.length > 40 ? Object.fromEntries(keys.slice(-20).map((k) => [k, s.byId[k]])) : s.byId;
      return { byId: { ...byId, [id]: label } };
    }),
}));
