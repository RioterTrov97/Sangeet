import './src/boot';
import { Platform } from 'react-native';

// Android TV (Google TV) gets its own D-pad driven UI; phones and iOS use the Expo Router app. `require` keeps the
// other app's modules from being evaluated.
/* eslint-disable @typescript-eslint/no-require-imports */
if (Platform.isTV) require('./src/tv/entry');
else require('expo-router/entry');
