import type { StyleProp, ViewStyle } from 'react-native';

/** AirPlay route picker is iOS-only; renders nothing on Android. */
export const RoutePickerView = (_props: { style?: StyleProp<ViewStyle>; tint?: string; activeTint?: string; prioritizeVideo?: boolean }) => null;

export const airPlayAvailable = () => false;
export const airPlayActive = () => false;
export const showAirPlayPicker = () => {};
export const onAirPlayChange = (_l: (s: { available: boolean; active: boolean }) => void) => ({ remove() {} });
export const currentRouteName = () => '';
