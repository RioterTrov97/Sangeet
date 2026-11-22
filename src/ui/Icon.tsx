import { Platform } from 'react-native';
import { SymbolView, type SFSymbol, type SymbolViewProps } from 'expo-symbols';

import { FALLBACK_MATERIAL, MATERIAL_NAMES } from './iconNames';

export type IconProps = Omit<SymbolViewProps, 'name'> & { name: SFSymbol };

/**
 * One icon for every phone screen. iOS renders the SF Symbol exactly as before; Android renders the mapped Material Symbol
 * (expo-symbols draws SF names as nothing there). Use this instead of importing SymbolView.
 */
export function Icon({ name, ...props }: IconProps) {
  if (Platform.OS !== 'android') return <SymbolView name={name} {...props} />;
  const android = (MATERIAL_NAMES as Record<string, string>)[name] ?? FALLBACK_MATERIAL;
  return <SymbolView name={{ android: android as never }} {...props} />;
}
