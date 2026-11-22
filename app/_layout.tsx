import '../src/ui/unistyles';

import { Figtree_400Regular, Figtree_500Medium, Figtree_700Bold, Figtree_800ExtraBold } from '@expo-google-fonts/figtree';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { RemoteBanner } from '../src/remote/RemoteBanner';
import { ActionSheetHost } from '../src/ui/ActionSheet';
import { NoticeBanner } from '../src/ui/NoticeBanner';
import { queryClient } from '../src/youtube/queryClient';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded, error] = useFonts({ Figtree_400Regular, Figtree_500Medium, Figtree_700Bold, Figtree_800ExtraBold });
  const ready = loaded || !!error;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#121212' }}>
      <QueryClientProvider client={queryClient}>
        <BottomSheetModalProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, orientation: 'portrait', contentStyle: { backgroundColor: '#121212' } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="album/[id]" />
            <Stack.Screen name="artist/[id]" />
            <Stack.Screen name="playlist/[id]" />
            <Stack.Screen name="liked" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="history" />
            <Stack.Screen name="downloads" />
            <Stack.Screen name="on-device" />
            <Stack.Screen name="diagnostics" />
            <Stack.Screen name="mood" />
            <Stack.Screen name="local/[id]" />
            <Stack.Screen name="signin" options={{ presentation: 'modal' }} />
            <Stack.Screen name="player" options={{ presentation: 'modal', statusBarHidden: false }} />
            <Stack.Screen name="lyrics" options={{ presentation: 'modal' }} />
            <Stack.Screen name="video" options={{ presentation: 'fullScreenModal', animation: 'fade', orientation: 'landscape', statusBarHidden: true, autoHideHomeIndicator: true, contentStyle: { backgroundColor: '#000' } }} />
            <Stack.Screen name="queue" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, sheetCornerRadius: 24 }} />
          </Stack>
          <NoticeBanner />
          <RemoteBanner />
          <ActionSheetHost />
        </BottomSheetModalProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
