import { create } from 'zustand';

/** A transient one-line notice shown by the root `NoticeBanner` (e.g. "Skipped 3 songs that aren't downloaded"). */
export type NoticeAction = { label: string; onPress: () => void };
export const useNotice = create<{ text?: string; id: number; action?: NoticeAction }>(() => ({ text: undefined, id: 0 }));

let timer: ReturnType<typeof setTimeout> | undefined;
export function showNotice(text: string, ms = 4000, action?: NoticeAction): void {
  const id = useNotice.getState().id + 1;
  useNotice.setState({ text, id, action });
  clearTimeout(timer);
  timer = setTimeout(() => useNotice.getState().id === id && useNotice.setState({ text: undefined, action: undefined }), ms);
}

export const clearNotice = () => useNotice.setState({ text: undefined, action: undefined });
