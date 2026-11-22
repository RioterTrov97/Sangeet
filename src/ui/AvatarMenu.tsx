import { router } from 'expo-router';
import { Icon } from './Icon';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { signOut, useAuth } from '../auth/store';
import { confirmAction, openActionSheet } from './sheet';

/**
 * Avatar button on the left of the title row of Home, Search and Library. Opens Settings, History, Downloads and the
 * account entry. The sign-in does not expose a profile photo, so a generic person glyph stands in for it.
 */
export function AvatarMenu() {
  const { theme } = useUnistyles();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const open = () =>
    openActionSheet({
      header: {
        title: signedIn ? 'YouTube Music' : 'Not signed in',
        subtitle: signedIn ? 'Signed in' : 'Sign in for your own library',
        tile: (
          <View style={styles.headTile}>
            <Icon name="person.fill" size={26} tintColor={theme.colors.text} />
          </View>
        ),
      },
      actions: [
        { id: 'settings', label: 'Settings', icon: 'gearshape', onPress: () => router.push('/settings') },
        { id: 'history', label: 'History', icon: 'clock', onPress: () => router.push('/history' as never) },
        { id: 'downloads', label: 'Downloads', icon: 'arrow.down.circle', onPress: () => router.push('/downloads' as never) },
        signedIn
          ? confirmAction({ id: 'signout', label: 'Sign out', icon: 'rectangle.portrait.and.arrow.right', title: 'Sign out?', text: 'This removes the YouTube Music rows from your library and returns to anonymous mode. Local likes, playlists and downloads stay.', confirmLabel: 'Sign out', onConfirm: () => void signOut() })
          : { id: 'signin', label: 'Sign in', icon: 'person.crop.circle', onPress: () => router.push('/signin') },
      ],
    });
  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={signedIn ? 'Account menu' : 'Menu: settings, history, downloads, sign in'}>
      <View style={styles.avatar}>
        <Icon name="person.fill" size={18} tintColor={theme.colors.text} />
      </View>
    </Pressable>
  );
}

/** Round clock button on the right of the Home and Search title rows: opens History. Same size as the avatar. */
export function HistoryButton() {
  const { theme } = useUnistyles();
  return (
    <Pressable style={styles.avatar} onPress={() => router.push('/history' as never)} accessibilityRole="button" accessibilityLabel="History">
      <Icon name="clock" size={18} tintColor={theme.colors.text} />
    </Pressable>
  );
}

/** Round gear button (Home title row): opens Settings. Same size as the avatar. */
export function SettingsButton() {
  const { theme } = useUnistyles();
  return (
    <Pressable style={styles.avatar} onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Settings">
      <Icon name="gearshape" size={18} tintColor={theme.colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  headTile: { width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
}));
