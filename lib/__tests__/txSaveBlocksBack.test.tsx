import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { router } from 'expo-router';
import AddTransactionModal from '@/app/modal';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { warmUp } from '@/test-utils/warmUp';

/**
 * الرجوع وقت الحفظ (money-reviewer قبل الدمج، 2026-11-17): الحفظ الجديد بيستنى نسخة الـoutbox (لحد
 * ~800ms). زرار أندرويد / سحب المودال في الوقت ده كان بيقفل المودال والحفظ مكمّل، وبعدين `router.back()`
 * بتاع الحفظ يشيل الشاشة اللي ورا. دلوقتي الشاشة مبتتشالش طول الحفظ، والرجوع بعده بيحصل بس لو لسه متركّبة.
 */

const navRef = createNavigationContainerRef<any>();
jest.mock('expo-router', () => ({
  // الرجوع الحقيقي على الـnavigator اللي في الاختبار — رجوع زيادة هيشيل شاشة "ورا" فعلاً
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return { ...actual, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const wallet = { id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 };
const wrap = (node: React.ReactNode) => <ThemeProvider><NoticeProvider><ConfirmProvider><PrivacyProvider>{node}</PrivacyProvider></ConfirmProvider></NoticeProvider></ThemeProvider>;

let resolveAdd: () => void = () => {};
function seed() {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [wallet], categories: [], transactions: [], debts: [], subscriptions: [], gamiyas: [], incomes: [],
    linkSourcesReady: true, loadErrors: [], figuresPending: [], retryLoad: jest.fn(), transactionLinkWarning: () => null,
    // الكتابة المتينة: بترجع بعد ما نسخة الـoutbox تتكتب — هنا بتفضل معلّقة لحد ما الاختبار يقول
    addTransaction: jest.fn(() => new Promise<void>(r => { resolveAdd = r; })),
    updateTransaction: jest.fn(), deleteTransaction: jest.fn(),
  });
}
beforeEach(() => {
  seed();
  (router.back as jest.Mock).mockReset().mockImplementation(() => { if (navRef.isReady() && navRef.canGoBack()) navRef.goBack(); });
});

warmUp(() => { seed(); return wrap(<AddTransactionModal />); });

const Stack = createNativeStackNavigator();
const Screen = (name: string) => () => <Text>{name}</Text>;
const Root = Screen('root'); const Home = Screen('home');
function App() {
  return wrap(
    <NavigationContainer ref={navRef}>
      <Stack.Navigator initialRouteName="root">
        <Stack.Screen name="root" component={Root} />
        <Stack.Screen name="home" component={Home} />
        <Stack.Screen name="modal" component={AddTransactionModal} options={{ presentation: 'modal' }} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}
const routeNames = () => navRef.getRootState().routes.map(r => r.name);

async function openAndStartSave() {
  await render(<App />);
  await act(async () => { navRef.navigate('home'); });
  await act(async () => { navRef.navigate('modal'); });
  expect(routeNames()).toEqual(['root', 'home', 'modal']);
  await act(async () => { fireEvent.changeText(screen.getByTestId('tx_amount_input'), '50'); });
  await act(async () => { fireEvent.press(screen.getByTestId('tx_save_button')); });
  expect(mockData.addTransaction).toHaveBeenCalledTimes(1);
}

describe('الرجوع وقت حفظ عملية جديدة', () => {
  it('رجوع (زرار أندرويد/سحب) والحفظ شغال ← المودال مبيتقفلش، وبعد الحفظ بيرجع مرة واحدة والشاشة اللي ورا فاضلة', async () => {
    await openAndStartSave();
    await act(async () => { navRef.goBack(); });
    expect(routeNames()).toEqual(['root', 'home', 'modal']);
    await act(async () => { resolveAdd(); });
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(routeNames()).toEqual(['root', 'home']);
  });

  it('من غير حفظ شغال الرجوع عادي', async () => {
    await render(<App />);
    await act(async () => { navRef.navigate('home'); });
    await act(async () => { navRef.navigate('modal'); });
    await act(async () => { navRef.goBack(); });
    expect(routeNames()).toEqual(['root', 'home']);
  });
});

describe('الرجوع بعد الحفظ', () => {
  it('الشاشة اتشالت قبل ما الحفظ يخلص ← مفيش router.back (كان هيشيل الشاشة اللي ورا)', async () => {
    const r = await render(wrap(<AddTransactionModal />));
    await act(async () => { fireEvent.changeText(screen.getByTestId('tx_amount_input'), '50'); });
    await act(async () => { fireEvent.press(screen.getByTestId('tx_save_button')); });
    await r.unmount();
    await act(async () => { resolveAdd(); });
    expect(mockData.addTransaction).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
  });
});
