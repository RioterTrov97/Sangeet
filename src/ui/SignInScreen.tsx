import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { StyleSheet } from 'react-native-unistyles';

import { captureCookies, completeSignIn } from '../auth/store';
import { isMusicUrl, SAFARI_UA, SIGN_IN_URL } from '../auth/cookies';
import { logWarn } from '../util/log';
import { IconButton } from './Controls';
import { Screen } from './Layout';

/**
 * Full-screen Google sign-in. The user types their credentials into Google's own page; the app never sees them.
 * Once the WebView lands on music.youtube.com and the WebKit cookie store holds an auth cookie, the cookie header is
 * stored in the keychain and the screen closes. Nothing here logs URLs with query strings or cookie values.
 */
export function SignInScreen() {
  const [busy, setBusy] = useState(false);
  const done = useRef(false);

  const onNav = async (nav: WebViewNavigation) => {
    if (done.current || !isMusicUrl(nav.url) || nav.loading) return;
    try {
      const header = await captureCookies();
      if (!header || done.current) return; // landed on music.youtube.com but not logged in yet
      done.current = true;
      setBusy(true);
      await completeSignIn(header);
      router.back();
    } catch (e) {
      done.current = false;
      setBusy(false);
      logWarn('auth', 'cookie capture failed', e instanceof Error ? e.message : e);
    }
  };

  return (
    <Screen top="sheet">
      <View style={styles.bar}>
        <IconButton name="xmark" label="Cancel sign in" onPress={() => router.back()} />
        <Text style={styles.title}>Sign in with Google</Text>
      </View>
      <WebView
        source={{ uri: SIGN_IN_URL }}
        userAgent={SAFARI_UA}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        incognito={false}
        onNavigationStateChange={onNav}
        startInLoadingState
        renderLoading={() => <ActivityIndicator style={styles.loading} />}
        style={styles.web}
        testID="signin-webview"
      />
      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator />
          <Text style={styles.busyText}>Signing in…</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, height: 48 },
  title: { color: theme.colors.text, ...theme.typography.heading },
  web: { flex: 1, backgroundColor: theme.colors.background },
  loading: { position: 'absolute', top: '45%', alignSelf: 'center' },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md },
  busyText: { color: theme.colors.text, ...theme.typography.body },
}));
