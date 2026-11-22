import { Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { clearNotice, useNotice } from '../util/notice';
import { useFloatingInset } from './floating';

/** Transient one-line notice, just above the floating tab bar (and the mini player while one shows). */
export function NoticeBanner() {
  const text = useNotice((s) => s.text);
  const action = useNotice((s) => s.action);
  const bottom = useFloatingInset();
  if (!text) return null;
  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none" accessibilityLiveRegion="polite">
      <View style={styles.pill}>
        <Text style={styles.text}>{text}</Text>
        {action ? (
          <Pressable
            onPress={() => {
              clearNotice();
              action.onPress();
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={action.label}>
            <Text style={styles.action}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: theme.spacing.lg },
  pill: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg, backgroundColor: theme.colors.surfaceElevated, borderRadius: theme.radii.full, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md },
  action: { color: theme.colors.accent, ...theme.typography.heading },
  text: { color: theme.colors.text, ...theme.typography.body, textAlign: 'center' },
}));
