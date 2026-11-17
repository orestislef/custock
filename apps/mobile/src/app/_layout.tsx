import { colors } from '@custock/tokens';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DisplayFontContext, useLoadDisplayFont } from '@/lib/fonts';
import { restoreLocale } from '@/lib/i18n';
import { startPushHandling } from '@/lib/push';
import { SessionProvider, useSession } from '@/lib/session';
import { SnackbarProvider } from '@/ui/Snackbar';

void SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
});

// short tasks open as sheets with a grabber and detents, the ios way
const sheet = (detents: number[] = [0.6, 1]) => ({
  presentation: 'formSheet' as const,
  sheetAllowedDetents: detents,
  sheetGrabberVisible: true,
  sheetCornerRadius: 28,
  headerShown: false,
});

function Navigator() {
  const { ready } = useSession();
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
    startPushHandling();
  }, [ready]);
  if (!ready) return null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="customer-sign-in" options={{ presentation: 'modal' }} />
      <Stack.Screen name="(work)" />
      <Stack.Screen name="(shopper)" />
      <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
      <Stack.Screen name="shop-picker" options={sheet([0.5, 0.9])} />
      <Stack.Screen name="sheet/adjust" options={sheet([0.7, 1])} />
      <Stack.Screen name="sheet/new-product" options={sheet([0.6, 1])} />
      <Stack.Screen name="sheet/invite" options={sheet([0.8, 1])} />
      <Stack.Screen name="sheet/language" options={sheet([0.45])} />
      <Stack.Screen name="push-explain" options={sheet([0.75])} />
    </Stack>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const fontReady = useLoadDisplayFont();
  const [localeReady, setLocaleReady] = useState(false);
  useEffect(() => {
    void restoreLocale().finally(() => setLocaleReady(true));
  }, []);

  const c = scheme === 'dark' ? colors.dark : colors.light;
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, primary: c.accent, background: c.shelf, card: c.surface, text: c.ink, border: c.line, notification: c.accent },
  };

  if (!localeReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={theme}>
          <DisplayFontContext.Provider value={fontReady}>
            <SessionProvider>
              <SnackbarProvider>
                <StatusBar style="auto" />
                <Navigator />
              </SnackbarProvider>
            </SessionProvider>
          </DisplayFontContext.Provider>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
