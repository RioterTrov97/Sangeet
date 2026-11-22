import type { BottomTabBarProps } from 'expo-router/js-tabs';
import type { SFSymbol } from 'expo-symbols';
import { Icon } from './Icon';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { Glass } from './Glass';
import { FLOAT_GAP, floatBottom, SIDE, TAB_H } from './floating';
import { MiniPlayer } from './MiniPlayer';
import { usePalette } from './palette/store';

const ICONS: Record<string, SFSymbol> = {
  index: 'house.fill',
  search: 'magnifyingglass',
  library: 'books.vertical.fill',
};

/** Floating chrome: a glass mini-player capsule above a glass tab capsule; list content scrolls underneath. */
export function TabBar({ state, descriptors, navigateToTab }: BottomTabBarProps) {
  const palette = usePalette();
  const { bottom } = useSafeAreaInsets();
  return (
    <View style={[styles.wrapper, { bottom: floatBottom(bottom) }]} pointerEvents="box-none">
      <MiniPlayer />
      <Glass radius={TAB_H / 2} style={styles.bar} interactive tint={`${palette.bgDeep}e6`}>
        <View style={styles.row}>
          {state.routes.map((route, i) => {
            if (!(route.name in ICONS)) return null;
            const focused = state.index === i;
            const color = focused ? palette.accent : 'rgba(255,255,255,0.72)';
            return (
              <Pressable
                key={route.key}
                style={styles.tab}
                accessibilityRole="button"
                accessibilityState={{ selected: focused }}
                onPress={() => {
                  if (!focused) navigateToTab(route.key);
                }}>
                <Icon name={ICONS[route.name] ?? 'circle'} tintColor={color} size={22} />
                <Text style={[styles.label, { color }]}>{descriptors[route.key].options.title ?? route.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrapper: { position: 'absolute', left: SIDE, right: SIDE, gap: FLOAT_GAP },
  bar: { height: TAB_H },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.sm },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 1 },
  label: { ...theme.typography.caption, fontSize: 11, lineHeight: 14 },
}));
