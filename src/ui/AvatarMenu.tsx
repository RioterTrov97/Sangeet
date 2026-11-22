import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Icon } from './Icon';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { signOut, useAuth } from '../auth/store';
import { confirmAction, openActionSheet } from './sheet';

/** The account photo in a circle when signed in and known, else the person glyph. */
export function AccountAvatar({ size }: { size: number }) {
  const { theme } = useUnistyles();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const photo = useAuth((s) => s.account?.photo);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (signedIn && photo) return <Image source={{ uri: photo }} style={[styles.photo, box]} contentFit="cover" accessibilityIgnoresInvertColors />;
  return (
    <View style={[styles.avatar, box]}>
      <Icon name="person.fill" size={Math.round(size / 2.2)} tintColor={theme.colors.text} />
    </View>
  );
}

/**
 * Avatar button on the left of the title row of Home, Search and Library: the account photo when signed in (else a
 * person glyph). Opens Settings, History, Downloads, Your Recap and the account entry.
 */
export function AvatarMenu() {
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const account = useAuth((s) => s.account);
  const open = () =>
    openActionSheet({
      header: {
        title: signedIn ? (account?.name ?? 'YouTube Music') : 'Not signed in',
        subtitle: signedIn ? (account?.handle ?? 'YouTube Music') : 'Sign in for your own library',
        tile: <AccountAvatar size={56} />,
      },
      actions: [
        { id: 'settings', label: 'Settings', icon: 'gearshape', onPress: () => router.push('/settings') },
        { id: 'history', label: 'History', icon: 'clock', onPress: () => router.push('/history' as never) },
        ...(signedIn ? [{ id: 'recap', label: 'Your Recap', icon: 'sparkles' as const, onPress: () => router.push('/recap' as never) }] : []),
        { id: 'downloads', label: 'Downloads', icon: 'arrow.down.circle', onPress: () => router.push('/downloads' as never) },
        signedIn
          ? confirmAction({ id: 'signout', label: 'Sign out', icon: 'rectangle.portrait.and.arrow.right', title: 'Sign out?', text: 'This removes the YouTube Music rows from your library and returns to anonymous mode. Local likes, playlists and downloads stay.', confirmLabel: 'Sign out', onConfirm: () => void signOut() })
          : { id: 'signin', label: 'Sign in', icon: 'person.crop.circle', onPress: () => router.push('/signin') },
      ],
    });
  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel="Account menu">
      <AccountAvatar size={36} />
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
  photo: { backgroundColor: theme.colors.surfaceHigh },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
}));
