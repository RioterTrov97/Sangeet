import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { StyleProp, ViewStyle } from 'react-native';

/** Native AVRoutePickerView (AirPlay / output device picker). Tap opens the system route sheet. */
export const RoutePickerView = requireNativeViewManager('RoutePicker') as React.ComponentType<{ style?: StyleProp<ViewStyle>; tint?: string; activeTint?: string; prioritizeVideo?: boolean }>;

type RouteNative = { isAvailable(): boolean; routeName?(): string; isActive(): boolean; showPicker(): void; addListener(e: 'onChange', l: (p: { available: boolean; active?: boolean }) => void): { remove(): void } };
const native = requireNativeModule<RouteNative>('RoutePicker');
export const airPlayAvailable = () => native.isAvailable();
/** Name of the current audio output (empty when unknown or on an older native build). */
export const currentRouteName = (): string => native.routeName?.() ?? '';
export const airPlayActive = () => native.isActive?.() ?? false;
/** Opens the system AirPlay sheet straight away (no visible button). */
export const showAirPlayPicker = () => native.showPicker?.();
export const onAirPlayChange = (l: (s: { available: boolean; active: boolean }) => void) => native.addListener('onChange', (p) => l({ available: p.available, active: !!p.active }));
