import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** Android Auto on phones: the build switch SANGEET_ANDROID_AUTO (read in app.config.ts, `extra.androidAuto`; default on). Never on iOS or the TV. */
export const androidAutoOn: boolean = Platform.OS === 'android' && !Platform.isTV && Constants.expoConfig?.extra?.androidAuto !== false;
