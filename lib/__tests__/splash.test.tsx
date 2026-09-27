/**
 * الـsplash (b1cf4c5 بعد التصليح): بيختفي لما التطبيق يجهز، ولو الخطوط فشلت،
 * ولو محدش جهز خالص بعد 5 ثواني — حتى لو RootNavigator ما اتركّبش أصلاً
 * (الخطوط علّقت). كل حالة بتحمّل الموديول من الأول: المؤقّت بيبدأ وقت التحميل.
 *
 * ده بيثبّت إننا بننادي hideAsync — مش إن الشاشة شكلها صح. ده بيتأكد على
 * بناء حقيقي بس: Expo Go بيعرض الـsplash بتاعه هو.
 */
import type * as SplashType from 'expo-splash-screen';

const mockFonts: { value: [boolean, Error | null] } = { value: [true, null] };
const mockReady = { auth: false };

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
jest.mock('@expo-google-fonts/tajawal', () => ({
  useFonts: () => mockFonts.value,
  Tajawal_400Regular: 1, Tajawal_500Medium: 2, Tajawal_700Bold: 3,
}));
jest.mock('react-native-reanimated', () => ({}));
jest.mock('expo-router', () => {
  const Stack = () => null;
  Stack.Screen = () => null;
  Stack.Protected = ({ children }: { children: unknown }) => children;
  return { Stack };
});
jest.mock('@/lib/sentry', () => ({ initSentry: jest.fn() }));
jest.mock('@/lib/applyGlobalFont', () => ({ applyGlobalFont: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve('1')),
}));
jest.mock('@/components/OnboardingScreen', () => ({ __esModule: true, default: () => null, ONBOARDING_KEY: 'k' }));
jest.mock('@/components/LockScreen', () => () => null);
jest.mock('@/components/DataLoadErrorBanner', () => () => null);
jest.mock('@/components/FirstRunSetup', () => () => null);
const pass = ({ children }: { children: unknown }) => children;
jest.mock('@/context/AppLockContext', () => ({
  AppLockProvider: pass, useAppLock: () => ({ enabled: false, isLocked: false, loading: false }),
}));
jest.mock('@/context/AuthContext', () => ({
  AuthProvider: pass, useAuth: () => ({ user: null, loading: !mockReady.auth }),
}));
jest.mock('@/context/DataContext', () => ({ DataProvider: pass, useData: () => ({ setupStatus: 'done' }) }));
jest.mock('@/context/NotificationsContext', () => ({ NotificationsProvider: pass }));
jest.mock('@/context/PrivacyContext', () => ({ PrivacyProvider: pass }));
jest.mock('@/context/ThemeContext', () => ({
  ThemeProvider: pass, useTheme: () => ({ theme: 'dark', colors: {} }),
}));

let sentry: { captureMessage: jest.Mock };

// كل رسمة بنسخة معزولة من مكتبة الاختبار (/pure مبتنضّفش لوحدها) — بتتشال هنا
const unmounts: (() => void)[] = [];

/** بيحمّل _layout من الأول (المؤقّت + الحالة) ويرسمه */
async function mountFresh() {
  let splash!: typeof SplashType;
  let run!: () => Promise<void>;
  jest.isolateModules(() => {
    splash = require('expo-splash-screen');
    sentry = require('@sentry/react-native');
    const React = require('react');
    const { render, act } = require('@testing-library/react-native/pure');
    const RootLayout = require('@/app/_layout').default;
    run = async () => {
      const view = await render(React.createElement(RootLayout));
      unmounts.push(() => act(() => view.unmount()));
      await act(async () => {}); // AsyncStorage.getItem
    };
  });
  await run();
  return splash;
}

describe('الـsplash', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    mockFonts.value = [true, null];
    mockReady.auth = false;
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(async () => {
    while (unmounts.length) await unmounts.pop()!();
    jest.useRealTimers();
    warn.mockRestore();
  });

  it('بيتمسك وقت التحميل، وبيختفي أول ما التطبيق يجهز', async () => {
    mockReady.auth = true;
    const splash = await mountFresh();
    expect(splash.preventAutoHideAsync).toHaveBeenCalledTimes(1);
    expect(splash.hideAsync).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5000);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('مش جاهز ← لسه ظاهر، وبعد 5 ثواني الحزام بيخفيه', async () => {
    const splash = await mountFresh();
    expect(splash.hideAsync).not.toHaveBeenCalled();
    jest.advanceTimersByTime(4999);
    expect(splash.hideAsync).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(splash.hideAsync).toHaveBeenCalledTimes(1);
    // الحزام اشتغل والتطبيق لسه ما جهزش ← حاجة علّقت، ولازم تبان في Sentry
    expect(sentry.captureMessage).toHaveBeenCalledWith(expect.stringContaining('safety timeout'), 'warning');
  });

  it('الخطوط علّقت (RootNavigator ما اتركّبش) ← الحزام برضه بيخفيه', async () => {
    mockFonts.value = [false, null];
    mockReady.auth = true;
    const splash = await mountFresh();
    expect(splash.hideAsync).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5000);
    expect(splash.hideAsync).toHaveBeenCalledTimes(1);
  });

  it('الخطوط فشلت ← التطبيق بيكمّل بخط النظام والـsplash بيختفي على طول', async () => {
    mockFonts.value = [false, new Error('font')];
    mockReady.auth = true;
    const splash = await mountFresh();
    expect(splash.hideAsync).toHaveBeenCalledTimes(1);
    expect(require('@/lib/applyGlobalFont').applyGlobalFont).not.toHaveBeenCalled();
  });

  it('جهز ← الحزام مبيناديش hideAsync تاني', async () => {
    mockReady.auth = true;
    const splash = await mountFresh();
    jest.advanceTimersByTime(5000);
    expect(splash.hideAsync).toHaveBeenCalledTimes(1);
  });

  function isolatedSplash() {
    let splash!: typeof SplashType;
    let mod!: typeof import('@/lib/splash');
    jest.isolateModules(() => {
      splash = require('expo-splash-screen');
      sentry = require('@sentry/react-native');
      mod = require('@/lib/splash');
    });
    return { splash, mod };
  }
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  it('الاتنين اترفضوا مرة ← مفيش promise من غير catch، وبيحاول تاني بعد ثانية', async () => {
    const { splash, mod } = isolatedSplash();
    (splash.preventAutoHideAsync as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error('y')));
    (splash.hideAsync as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error('x')));
    mod.holdSplash();
    mod.releaseSplash();
    await flush();
    expect(warn).toHaveBeenCalledWith('[splash] preventAutoHideAsync', expect.any(Error));
    expect(warn).toHaveBeenCalledWith('[splash] hideAsync', expect.any(Error));
    jest.advanceTimersByTime(1000);
    await flush();
    expect(splash.hideAsync).toHaveBeenCalledTimes(2);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('hideAsync فشل كل المحاولات ← بيقف عند 3 وبيتقال لـSentry (مش console بس)', async () => {
    const { splash, mod } = isolatedSplash();
    (splash.hideAsync as jest.Mock).mockImplementation(() => Promise.reject(new Error('x')));
    mod.releaseSplash();
    for (let i = 0; i < 5; i++) { await flush(); jest.advanceTimersByTime(1000); }
    await flush();
    expect(splash.hideAsync).toHaveBeenCalledTimes(3);
    expect(sentry.captureMessage).toHaveBeenCalledWith(expect.stringContaining('every attempt'), 'error');
  });

  it('المحاولات خلصت قبل الحزام ← الحزام مبيحاولش رابع ومبيبعتش "قبل الجاهزية" غلط', async () => {
    const { splash, mod } = isolatedSplash();
    (splash.hideAsync as jest.Mock).mockImplementation(() => Promise.reject(new Error('x')));
    mod.holdSplash();
    mod.releaseSplash('ready');
    for (let i = 0; i < 8; i++) { await flush(); jest.advanceTimersByTime(1000); }
    await flush();
    expect(splash.hideAsync).toHaveBeenCalledTimes(3);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledWith(expect.stringContaining('every attempt'), 'error');
  });
});
