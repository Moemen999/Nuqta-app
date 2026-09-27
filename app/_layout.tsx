import { Tajawal_400Regular, Tajawal_500Medium, Tajawal_700Bold, useFonts } from '@expo-google-fonts/tajawal';
import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import OnboardingScreen, { ONBOARDING_KEY } from '@/components/OnboardingScreen';
import { initSentry } from '@/lib/sentry';
import { applyGlobalFont } from '@/lib/applyGlobalFont';

import LockScreen from '@/components/LockScreen';
import { AppLockProvider, useAppLock } from '@/context/AppLockContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import DataLoadErrorBanner from '@/components/DataLoadErrorBanner';
import FirstRunSetup from '@/components/FirstRunSetup';
import { DataProvider, useData } from '@/context/DataContext';
import { NotificationsProvider } from '@/context/NotificationsContext';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';

export const unstable_settings = {
  anchor: '(tabs)',
};

/** لمحة "بنتأكد من حسابك" أول ما حساب يفتح أول مرة على الجهاز ده — ثواني بالكتير */
function SetupChecking() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12 }}
      accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={{ color: colors.textSecondary, fontSize: 14 }}>بنتأكد من حسابك…</Text>
    </View>
  );
}

function RootNavigator() {
  const { user, loading } = useAuth();
  const { theme } = useTheme();
  const { enabled, isLocked, loading: lockLoading } = useAppLock();
  const { setupStatus } = useData();
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

  // "نبدأ بإيه؟" للحساب الجديد بس — بعد القفل. `needed` معناها السيرفر أكّد إنه
  // جديد؛ `unknown` (مفيش نت) مبيقفلش التطبيق، والسؤال بيتعاد (DataContext).
  // `checking` لمحة قصيرة أول مرة بس — بعدها الحالة متفكرة على الجهاز.
  if (user && (setupStatus === 'needed' || setupStatus === 'checking')) {
    return (
      <NavThemeProvider value={theme === 'dark' ? DarkTheme : DefaultTheme}>
        {setupStatus === 'needed' ? <FirstRunSetup /> : <SetupChecking />}
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      </NavThemeProvider>
    );
  }

  return (
    <NavThemeProvider value={theme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* فوق الـStack كله مش التابات بس: الأرشيف وكشف الحساب والإعدادات بيعرضوا نفس القوايم */}
      <DataLoadErrorBanner />
      <Stack>
        <Stack.Protected guard={!!user}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="person-ledger" options={{ headerShown: false }} />
          <Stack.Screen name="archive" options={{ headerShown: false }} />
          <Stack.Screen name="user-guide" options={{ headerShown: false }} />
          {/* تعبئة حساب الاختبار — بترجع للرئيسية في الإنتاج (__DEV__) */}
          <Stack.Screen name="dev-seed" options={{ headerShown: false }} />
          {/*
            الشاشات الداخلية للإعدادات في فولدر `settings-screens` مش `settings`:
            تاب الإعدادات نفسه مساره `/settings` (من `app/(tabs)/settings.tsx` بعد
            ما المجموعة تتشال)، وفولدر اسمه `settings` كان هيحط عقدة تانية على
            نفس المقطع في جذر الـStack. مكناش نقدر نتأكد من سلوك ده من غير ما
            نشغّل التطبيق، والاسم المختلف بيقفل الاحتمال من أصله.
          */}
          <Stack.Screen name="settings-screens/wallets" options={{ headerShown: false }} />
          <Stack.Screen name="settings-screens/categories" options={{ headerShown: false }} />
          <Stack.Screen name="settings-screens/notifications" options={{ headerShown: false }} />
          <Stack.Screen name="settings-screens/lock" options={{ headerShown: false }} />
          <Stack.Screen name="settings-screens/about" options={{ headerShown: false }} />
          <Stack.Screen name="settings-screens/feedback" options={{ headerShown: false }} />
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

/**
 * Sentry بتتشغّل **برّه** الكومبوننت عن قصد.
 *
 * الأخطاء اللي بتحصل وقت تحميل الموديولات أو في أول render مبتتلقطش لو
 * التهيئة جوه `useEffect` — وقتها بيكون فات الأوان. ولو مفيش DSN الدالة
 * بترجع من غير ما تعمل حاجة، فالتطبيق بيشتغل عادي على أي جهاز مطوّر.
 */
initSentry();

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
      {/* فوق NotificationsProvider: الإشعارات بتشيل المبالغ لو مخفية */}
      <PrivacyProvider>
        <AppLockProvider>
          <AuthProvider>
            <DataProvider>
              <NotificationsProvider>
                <RootNavigator />
              </NotificationsProvider>
            </DataProvider>
          </AuthProvider>
        </AppLockProvider>
      </PrivacyProvider>
    </ThemeProvider>
  );
}