import { Tajawal_400Regular, Tajawal_500Medium, Tajawal_700Bold, useFonts } from '@expo-google-fonts/tajawal';
import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';
import OnboardingScreen, { ONBOARDING_KEY } from '@/components/OnboardingScreen';
import { applyGlobalFont } from '@/lib/applyGlobalFont';

import LockScreen from '@/components/LockScreen';
import { AppLockProvider, useAppLock } from '@/context/AppLockContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { DataProvider } from '@/context/DataContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootNavigator() {
  const { user, loading } = useAuth();
  const { theme } = useTheme();
  const { enabled, isLocked, loading: lockLoading } = useAppLock();
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then(v => setOnboardingDone(v === '1'))
      .catch(() => setOnboardingDone(true));
  }, []);

  if (loading || lockLoading || onboardingDone === null) return null;

  // شاشة الترحيب بتظهر مرة واحدة بس لأول مستخدم جديد
  if (!onboardingDone) {
    return (
      <NavThemeProvider value={theme === 'dark' ? DarkTheme : DefaultTheme}>
        <OnboardingScreen onDone={() => setOnboardingDone(true)} />
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      </NavThemeProvider>
    );
  }

  if (enabled && isLocked) {
    return (
      <NavThemeProvider value={theme === 'dark' ? DarkTheme : DefaultTheme}>
        <LockScreen />
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      </NavThemeProvider>
    );
  }

  return (
    <NavThemeProvider value={theme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Protected guard={!!user}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="person-ledger" options={{ headerShown: false }} />
          <Stack.Screen name="archive" options={{ headerShown: false }} />
          <Stack.Screen name="user-guide" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
        {/* بره الحماية: لازم يشتغل قبل تسجيل الدخول كمان، لأنه بيستقبل رجوع جوجل والمستخدم لسه مش داخل */}
        <Stack.Screen name="oauth2redirect" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Tajawal_400Regular,
    Tajawal_500Medium,
    Tajawal_700Bold,
  });

  // بنطبّق الخط على كل نصوص التطبيق أول ما يحمّل
  useEffect(() => {
    if (fontsLoaded) applyGlobalFont();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <ThemeProvider>
      <AppLockProvider>
        <AuthProvider>
          <DataProvider>
            <RootNavigator />
          </DataProvider>
        </AuthProvider>
      </AppLockProvider>
    </ThemeProvider>
  );
}