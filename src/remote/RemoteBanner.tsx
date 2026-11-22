import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useFloatingInset } from '../ui/floating';
import { useRemote } from './phone';

/**
 * Bottom banner shown while the TV has been silent for more than 5 s (auto-reconnecting). Sits just above the floating
 * mini-player and tab bar, in neutral colours (not the song palette, not an error red): the TV keeps playing meanwhile.
 */
export function RemoteBanner() {
  const status = useRemote((s) => s.status);
  const name = useRemote((s) => s.tvName);
  const bottom = useFloatingInset();
  if (status !== 'lost') return null;
  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="none" accessibilityLiveRegion="polite">
      <View style={styles.pill}>
        <SymbolView name="tv" size={18} tintColor="#FFFFFF" />
        <Text style={styles.text} numberOfLines={1}>
          Reconnecting to {name || 'TV'}…
        </Text>
        <ActivityIndicator size="small" color="#FFFFFF" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: theme.spacing.lg },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    maxWidth: '100%',
    backgroundColor: 'rgba(40,40,40,0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: theme.radii.full,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  text: { color: theme.colors.text, ...theme.typography.body, flexShrink: 1 },
}));
