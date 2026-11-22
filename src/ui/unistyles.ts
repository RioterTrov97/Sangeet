import { StyleSheet } from 'react-native-unistyles';

import { appThemes, type AppThemes } from './theme';

declare module 'react-native-unistyles' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface UnistylesThemes extends AppThemes {}
}

StyleSheet.configure({
  themes: appThemes,
  settings: { initialTheme: 'dark' },
});
