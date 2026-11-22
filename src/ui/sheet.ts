import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { create } from 'zustand';

import type { Artwork } from '../youtube/models';
import { tap } from './haptic';
import { isPlayerOpen } from './playerOpen';

export type SheetAction = {
  id: string;
  label: string;
  icon?: SFSymbol;
  destructive?: boolean;
  /** Radio-style option: shows a check on the selected one. */
  checked?: boolean;
  /** Opens a second page in the same sheet instead of running `onPress`. */
  sub?: SheetPage;
  onPress?: () => void | Promise<void>;
  /**
   * Runs `onPress` only once the sheet's native modal is gone. Needed for actions that present a system screen (the Files
   * picker): presented over the closing sheet, it is torn down together with it.
   */
  afterGone?: boolean;
};
export type SheetPage = {
  title: string;
  actions: SheetAction[];
  /** A confirmation page: `text`, a red confirm pill (`label`) and Cancel, instead of `actions`. */
  confirm?: { text: string; label: string; icon?: SFSymbol; onConfirm: () => void };
};

/** A row that opens an in-sheet confirmation page (replaces Alert.alert). */
export const confirmAction = (a: { id: string; label: string; icon: SFSymbol; title: string; text: string; confirmLabel: string; onConfirm: () => void; destructive?: boolean }): SheetAction => ({
  id: a.id,
  label: a.label,
  icon: a.icon,
  destructive: a.destructive ?? true,
  sub: { title: a.title, actions: [], confirm: { text: a.text, label: a.confirmLabel, icon: a.icon, onConfirm: a.onConfirm } },
});
export type SheetHeader = {
  title: string;
  subtitle?: string;
  art?: Artwork[];
  /** Replaces `art` (a gradient tile, a playlist cover, ...). Drawn 56 pt square. */
  tile?: ReactNode;
  round?: boolean;
};

export type SheetSpec = { header?: SheetHeader; actions?: SheetAction[]; custom?: (close: () => void) => ReactNode; title?: string; confirm?: SheetPage['confirm'] };

type SheetState = { spec?: SheetSpec; seq: number; scope: 'root' | 'player' };
export const useSheet = create<SheetState>(() => ({ seq: 0, scope: 'root' }));

/** Opens the shared bottom sheet (rows of actions). Mounted once at the root by <ActionSheetHost/>. */
export function openActionSheet(spec: SheetSpec): void {
  tap();
  // The player is a native modal: an RN Modal cannot present over it, so its sheets render inside it.
  useSheet.setState((s) => ({ spec, seq: s.seq + 1, scope: isPlayerOpen() ? 'player' : 'root' }));
}

/** Opens the same sheet chrome with custom content (Play on, Spotify import). */
export const openCustomSheet = (custom: (close: () => void) => ReactNode, opts: { title?: string; header?: SheetHeader } = {}) => openActionSheet({ custom, title: opts.title, header: opts.header });

export const dismissActionSheet = () => useSheet.setState({ spec: undefined });

/** A stand-alone confirmation sheet (title, text, red confirm pill, Cancel) for buttons that used Alert.alert. */
export const confirmSheet = (c: { title: string; text: string; label: string; icon?: SFSymbol; onConfirm: () => void }) =>
  openActionSheet({ header: { title: c.title }, confirm: { text: c.text, label: c.label, icon: c.icon, onConfirm: c.onConfirm } });
