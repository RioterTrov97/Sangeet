import { requireOptionalNativeModule } from 'expo';
import type { StyleProp, ViewStyle } from 'react-native';

/** The AirPlay picker view is iOS-only; renders nothing on Android. */
export const RoutePickerView = (_props: { style?: StyleProp<ViewStyle>; tint?: string; activeTint?: string; prioritizeVideo?: boolean }) => null;

type Native = { isAvailable(): boolean; showPicker(): void };
const native = requireOptionalNativeModule<Native>('RoutePicker');

/** Android: the system sound output switcher is available (Android 10+). There is no "AirPlay active" notion, so `airPlayActive` stays false. */
export const airPlayAvailable = () => !!native?.isAvailable();
export const airPlayActive = () => false;
/** Opens the system output switcher (volume panel with "Media output"). */
export const showAirPlayPicker = () => native?.showPicker();
export const onAirPlayChange = (_l: (s: { available: boolean; active: boolean }) => void) => ({ remove() {} });
export const currentRouteName = () => '';
