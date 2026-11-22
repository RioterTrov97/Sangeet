import { SymbolView } from 'expo-symbols';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

/** The trailing ... button of a row: opens that row's action sheet. */
export function MoreButton({ label, onPress, style, color }: { label: string; onPress: () => void; style?: StyleProp<ViewStyle>; color?: string }) {
  const { theme } = useUnistyles();
  return (
    <Pressable hitSlop={6} onPress={onPress} style={[{ padding: 12 }, style]} accessibilityRole="button" accessibilityLabel={label}>
      <SymbolView name="ellipsis" size={18} tintColor={color ?? theme.colors.textSecondary} />
    </Pressable>
  );
}
