import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { StatusBar as NativeStatusBar, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ConvexProvider } from 'convex/react';
import { convexClient } from '@/lib/convex';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style="dark" />
      <NativeStatusBar barStyle="dark-content" backgroundColor="#F8FAFC" translucent={false} />
      <AnimatedSplashOverlay />
      {convexClient ? <ConvexProvider client={convexClient}><Stack screenOptions={{ headerShown: false }} /></ConvexProvider> : <Stack screenOptions={{ headerShown: false }} />}
    </ThemeProvider>
  );
}
