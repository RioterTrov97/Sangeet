import { BlurView } from 'expo-blur';
import { Icon } from './Icon';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Artwork } from './Artwork';
import { tap } from './haptic';
import { dismissActionSheet, useSheet, type SheetAction, type SheetHeader, type SheetPage } from './sheet';

const CLOSE_MS = 200;

/**
 * The one bottom sheet (item actions, sort, Play on, import). Dimmed + blurred backdrop, grab handle, slides up on the UI
 * thread, closes by dragging the handle/header down or tapping outside. Rows are rounded pills; a row can open a second page.
 */
export function ActionSheetHost({ scope = 'root' }: { scope?: 'root' | 'player' }) {
  const spec = useSheet((s) => (s.scope === scope ? s.spec : undefined));
  const seq = useSheet((s) => s.seq);
  const [shown, setShown] = useState<typeof spec>(undefined);
  const [key, setKey] = useState(0);
  // Mount/unmount follows the store; the sheet animates itself out before the store is cleared.
  useEffect(() => {
    if (spec) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors the store so the closing animation can finish first
      setShown(spec);
      setKey(seq);
    }
  }, [spec, seq]);
  if (!shown) return null;
  return <SheetModal key={key} inline={scope === 'player'} spec={shown} open={!!spec} onGone={() => setShown(undefined)} />;
}

function SheetModal({ spec, open, onGone, inline }: { inline?: boolean; spec: NonNullable<ReturnType<typeof useSheet.getState>['spec']>; open: boolean; onGone: () => void }) {
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const screenH = Dimensions.get('window').height;
  const progress = useSharedValue(0); // 0 closed, 1 open
  const drag = useSharedValue(0);
  const [stack, setStack] = useState<SheetPage[]>([]);
  const closing = useSharedValue(false);

  const afterGone = useRef<(() => void) | undefined>(undefined);
  const finish = useCallback(() => {
    onGone();
    dismissActionSheet();
    // The modal unmounts with onGone; UIKit finishes dismissing it a moment later.
    const run = afterGone.current;
    afterGone.current = undefined;
    if (run) setTimeout(run, GONE_SETTLE_MS);
  }, [onGone]);
  const close = useCallback(
    (after?: () => void) => {
      if (closing.get()) return;
      closing.set(true);
      progress.set(withTiming(0, { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) scheduleOnRN(finish);
      }));
      if (after) setTimeout(after, CLOSE_MS * 0.6);
    },
    [finish, progress, closing],
  );
  useEffect(() => {
    progress.set(withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, [progress]);
  useEffect(() => {
    if (!open) close();
  }, [open, close]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    // eslint-disable-next-line react-hooks/refs -- close only touches afterGone inside a callback that runs after the sheet is gone, never during render
    .onEnd((e) => {
      if (e.translationY > 90 || e.velocityY > 900) scheduleOnRN(close);
      else drag.value = withTiming(0, { duration: 160 });
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(progress.value, [0, 1], [screenH, 0]) + drag.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const page = stack[stack.length - 1];
  const confirm = page ? page.confirm : spec.confirm;
  const press = (a: SheetAction) => {
    tap();
    if (a.sub) return setStack((s) => [...s, a.sub!]);
    if (a.afterGone) {
      afterGone.current = () => void a.onPress?.();
      return close();
    }
    close(() => void a.onPress?.());
  };

  const body = spec.custom ? (
    // eslint-disable-next-line react-hooks/refs -- close() is only invoked from the custom body's event handlers
    spec.custom(() => close())
  ) : (
    <>
      {page ? (
        <Pressable style={styles.back} onPress={() => setStack((s) => s.slice(0, -1))} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevron.left" size={18} tintColor={theme.colors.text} />
          <Text style={styles.backText}>{page.title}</Text>
        </Pressable>
      ) : null}
      {confirm ? (
        <>
          <Text style={styles.confirmText}>{confirm.text}</Text>
          <Row action={{ id: 'confirm', label: confirm.label, icon: confirm.icon ?? 'trash', destructive: true }} onPress={() => { tap(); close(() => confirm.onConfirm()); }} />
          <Row action={{ id: 'cancel', label: 'Cancel', icon: 'xmark' }} onPress={() => { tap(); close(); }} />
        </>
      ) : (
        (page ? page.actions : (spec.actions ?? [])).map((a) => <Row key={a.id} action={a} onPress={() => press(a)} />)
      )}
    </>
  );

  const Wrap = inline ? InlineWrap : ModalWrap;
  return (
    <Wrap onClose={() => close()}>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, styles.dim]} />
        </Animated.View>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel="Close" accessibilityRole="button" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
          <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8, maxHeight: screenH * 0.86 }, sheetStyle]} accessibilityViewIsModal>
            <GestureDetector gesture={pan}>
              <View collapsable={false}>
                <View style={styles.handleWrap}>
                  <View style={styles.handle} />
                </View>
                {spec.header && !spec.custom ? <Header h={spec.header} /> : null}
                {spec.title && spec.custom ? <Text style={styles.customTitle} accessibilityRole="header">{spec.title}</Text> : null}
              </View>
            </GestureDetector>
            <ScrollView bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.rows}>
              {body}
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Wrap>
  );
}

/** After the sheet's modal unmounts, before an `afterGone` action presents a system screen. */
const GONE_SETTLE_MS = 350;
const ModalWrap = ({ children, onClose }: { children: ReactNode; onClose: () => void }) => (
  <Modal transparent animationType="none" visible statusBarTranslucent onRequestClose={onClose}>
    {children}
  </Modal>
);
const InlineWrap = ({ children }: { children: ReactNode; onClose: () => void }) => <View style={StyleSheet.absoluteFill}>{children}</View>;

function Header({ h }: { h: SheetHeader }) {
  return (
    <View style={styles.header}>
      {h.tile ? <View style={styles.tile}>{h.tile}</View> : h.art ? <Artwork art={h.art} size={56} round={h.round} /> : null}
      <View style={styles.headerText}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {h.title}
        </Text>
        {h.subtitle ? (
          <Text style={styles.headerSub} numberOfLines={1}>
            {h.subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Row({ action, onPress }: { action: SheetAction; onPress: () => void }) {
  const { theme } = useUnistyles();
  const color = action.destructive ? theme.colors.error : theme.colors.text;
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={action.label} accessibilityState={action.checked === undefined ? undefined : { selected: action.checked }}>
      {action.icon ? <Icon name={action.icon} size={20} tintColor={action.destructive ? theme.colors.error : theme.colors.accent} style={styles.icon} /> : null}
      <Text style={[styles.rowText, { color }]} numberOfLines={1}>
        {action.label}
      </Text>
      {action.checked ? <Icon name="checkmark" size={16} tintColor={theme.colors.accent} /> : null}
      {action.sub ? <Icon name="chevron.right" size={14} tintColor={theme.colors.textSecondary} /> : null}
    </Pressable>
  );
}

export const SHEET_ROW_H = 52;

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1 },
  dim: { backgroundColor: 'rgba(0,0,0,0.38)' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1b1b1d', borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden', paddingHorizontal: theme.spacing.lg },
  handleWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 10 },
  handle: { width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingBottom: theme.spacing.md, marginBottom: theme.spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.14)' },
  tile: { width: 56, height: 56, borderRadius: 4, overflow: 'hidden' },
  headerText: { flex: 1 },
  headerTitle: { color: theme.colors.text, ...theme.typography.heading },
  headerSub: { color: theme.colors.textSecondary, ...theme.typography.body },
  customTitle: { color: theme.colors.text, ...theme.typography.title, paddingBottom: theme.spacing.md },
  rows: { gap: 10, paddingBottom: theme.spacing.sm },
  row: { height: SHEET_ROW_H, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, borderRadius: 16, backgroundColor: theme.colors.surfaceElevated },
  rowPressed: { opacity: 0.7 },
  icon: { width: 24, height: 24 },
  rowText: { flex: 1, ...theme.typography.bodyLarge },
  back: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, height: 40 },
  confirmText: { color: theme.colors.textSecondary, ...theme.typography.bodyLarge, paddingBottom: theme.spacing.xs },
  backText: { color: theme.colors.text, ...theme.typography.heading },
}));
