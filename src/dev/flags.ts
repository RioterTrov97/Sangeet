import Constants from 'expo-constants';

/** The dev deep-link driver runs in dev builds and in screenshot builds (SANGEET_SCREENSHOTS=1 in app.config.ts), never in TestFlight builds. */
export const devDriverEnabled: boolean = __DEV__ || Constants.expoConfig?.extra?.screenshots === true;
