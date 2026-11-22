import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Pressable, Text, type StyleProp, type ViewStyle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

export function IconButton({ name, size = 22, color, label, onPress, style, active }: { name: SFSymbol; size?: number; color?: string; label: string; onPress?: () => void; style?: StyleProp<ViewStyle>; active?: boolean }) {
  const { theme } = useUnistyles();
  return (
    <Pressable hitSlop={12} onPress={onPress} style={style} accessibilityRole="button" accessibilityLabel={label} accessibilityState={active === undefined ? undefined : { selected: active }}>
      <SymbolView name={name} size={size} tintColor={color ?? (active ? theme.colors.accent : theme.colors.text)} fallback={<Text style={{ color: theme.colors.text }}>•</Text>} />
    </Pressable>
  );
}

/** Circular play/pause button (accent green by default; pass `fill`/`iconColor` for the palette or white variants). */
export function PlayButton({ playing, size = 56, onPress, label, fill, iconColor = '#000' }: { playing?: boolean; size?: number; onPress: () => void; label?: string; fill?: string; iconColor?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? (playing ? 'Pause' : 'Play')}
      style={[styles.play, fill ? { backgroundColor: fill } : null, { width: size, height: size, borderRadius: size / 2 }]}>
      <SymbolView name={playing ? 'pause.fill' : 'play.fill'} size={size * 0.45} tintColor={iconColor} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: !!selected }} accessibilityLabel={`Filter ${label}`}>
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  play: { backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm, borderRadius: theme.radii.full, backgroundColor: theme.colors.surfaceElevated },
  chipOn: { backgroundColor: theme.colors.accent },
  chipText: { color: theme.colors.text, ...theme.typography.body },
  chipTextOn: { color: '#000', fontFamily: theme.typography.heading.fontFamily },
}));
