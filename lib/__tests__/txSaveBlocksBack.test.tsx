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
import { reportAtomicFailure } from '@/lib/atomicFailure';

/**
 * الرجوع وقت الحفظ (money-reviewer قبل الدمج، 2026-11-17): الحفظ الجديد بيستنى نسخة الـoutbox (لحد
 * ~800ms). زرار أندرويد / سحب المودال في الوقت ده كان بيقفل المودال والحفظ مكمّل، وبعدين `router.back()`
 * بتاع الحفظ يشيل الشاشة اللي ورا. دلوقتي الشاشة مبتتشالش طول الحفظ، والرجوع بعده بيحصل بس لو لسه متركّبة.
 */

const navRef = createNavigationContainerRef<any>();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  // الرجوع الحقيقي على الـnavigator اللي في الاختبار — رجوع زيادة هيشيل شاشة "ورا" فعلاً
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/atomicFailure', () => ({ reportAtomicFailure: jest.fn() }));
// شيت التسوية: الاختبار هو اللي بيقرر إمتى "المستخدم رد" (`mockSettleNow` false ← الرد بيستنى)
let mockSettleNow = true;
let mockSettleReply: ((s: unknown[]) => unknown) | null = null;
jest.mock('@/components/ArchivedSettlement', () => ({
  useArchivedSettlement: () => ({
    needsSettlement: () => false,
    request: (_c: unknown, run: (s: unknown[]) => unknown) => { if (mockSettleNow) run([]); else mockSettleReply = run; },
    sheet: null,
  }),
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
  mockParams = {};
  mockSettleNow = true;
  mockSettleReply = null;
  (reportAtomicFailure as jest.Mock).mockClear();
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
        <Stack.Screen name="other" component={Screen('other')} />
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

/* ─── المراجعة الأخيرة (silent-failure-hunter جولة 2 + money-reviewer) ─── */

describe('الرجوع بعد الحفظ والشاشة مش قدام', () => {
  it('شاشة فوق المودال وقت ما الحفظ خلص ← مفيش رجوع ساكت ولا رجوع يشيل اللي فوق؛ أول ما يرجع قدام بيرجع مرة واحدة', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await openAndStartSave();
      await act(async () => { navRef.navigate('other'); });
      await act(async () => { resolveAdd(); });
      expect(router.back).not.toHaveBeenCalled();
      expect(routeNames()).toEqual(['root', 'home', 'modal', 'other']);
      expect(warn).toHaveBeenCalledWith('[tx] الرجوع بعد الحفظ مستني الشاشة ترجع قدام');
      await act(async () => { navRef.goBack(); }); // "other" اتشالت ← المودال قدام
      expect(router.back).toHaveBeenCalledTimes(1);
      expect(routeNames()).toEqual(['root', 'home']);
    } finally { warn.mockRestore(); }
  });

  it('router.back رمى بعد الحفظ ← بيتبلّغ، المنع بيتشال (رجوع أندرويد شغال)، و"حفظ" تاني بيرجع بس من غير حفظ تاني', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      (router.back as jest.Mock).mockImplementationOnce(() => { throw new Error('nav'); });
      await openAndStartSave();
      await act(async () => { resolveAdd(); });
      expect(reportAtomicFailure).toHaveBeenCalledWith('حفظ العملية', expect.any(Error));
      expect(routeNames()).toEqual(['root', 'home', 'modal']);
      await act(async () => { fireEvent.press(screen.getByTestId('tx_save_button')); });
      expect(mockData.addTransaction).toHaveBeenCalledTimes(1);
      expect(router.back).toHaveBeenCalledTimes(2);
      expect(routeNames()).toEqual(['root', 'home']);
    } finally { warn.mockRestore(); }
  });

  it('router.back رمى ← رجوع أندرويد بعدها بيقفل المودال (مش متمنع للأبد)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      (router.back as jest.Mock).mockImplementationOnce(() => { throw new Error('nav'); });
      await openAndStartSave();
      await act(async () => { resolveAdd(); });
      await act(async () => { navRef.goBack(); });
      expect(routeNames()).toEqual(['root', 'home']);
    } finally { warn.mockRestore(); }
  });
});

const existingTx = { id: 't1', type: 'expense', amount: 30, walletId: 'w1', date: '2026-11-17' };
async function openEdit() {
  mockParams = { id: 't1' };
  mockData.transactions = [existingTx];
  await render(<App />);
  await act(async () => { navRef.navigate('home'); });
  await act(async () => { navRef.navigate('modal'); });
  await act(async () => {});
  expect(routeNames()).toEqual(['root', 'home', 'modal']);
}

describe('الحذف', () => {
  it('رجوع والحذف شغال ← متمنع (حتى لما العملية تختفي من القايمة في النص)، وبعد الحذف رجوع واحد والشاشة اللي ورا فاضلة', async () => {
    let resolveDelete!: () => void;
    mockData.deleteTransaction = jest.fn(() => {
      mockData.transactions = []; // الكتابة المحلية بترد فورًا: العملية بتختفي والحذف لسه ما رجعش
      return new Promise<{ outcome: 'done' }>(r => { resolveDelete = () => r({ outcome: 'done' }); });
    });
    await openEdit();
    await act(async () => { fireEvent.press(screen.getByText('حذف')); });
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
    expect(mockData.deleteTransaction).toHaveBeenCalledTimes(1);
    await act(async () => { navRef.goBack(); });
    expect(routeNames()).toEqual(['root', 'home', 'modal']);
    expect(router.back).not.toHaveBeenCalled();
    await act(async () => { resolveDelete(); });
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(routeNames()).toEqual(['root', 'home']);
  });

  it('الحذف فشل ← رسالة على الشاشة والرجوع بيتفتح تاني', async () => {
    mockData.deleteTransaction = jest.fn(async () => { throw new Error('stage'); });
    await openEdit();
    await act(async () => { fireEvent.press(screen.getByText('حذف')); });
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
    expect(screen.getByTestId('tx_error')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    await act(async () => { navRef.goBack(); });
    expect(routeNames()).toEqual(['root', 'home']);
  });
});

describe('التعديل بعد رد شيت التسوية', () => {
  it('الرد جه بعد ما الحارس اتفك ← الرجوع متمنع طول `updateTransaction`، وبعدها رجوع واحد', async () => {
    let resolveUpdate!: () => void;
    mockData.updateTransaction = jest.fn(() => new Promise<void>(r => { resolveUpdate = r; }));
    mockSettleNow = false;
    await openEdit();
    await act(async () => { fireEvent.press(screen.getByTestId('tx_save_button')); });
    expect(mockSettleReply).not.toBeNull();
    await act(async () => { void mockSettleReply!([]); });
    expect(mockData.updateTransaction).toHaveBeenCalledTimes(1);
    await act(async () => { navRef.goBack(); });
    expect(routeNames()).toEqual(['root', 'home', 'modal']);
    await act(async () => { resolveUpdate(); });
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(routeNames()).toEqual(['root', 'home']);
  });

  it('updateTransaction رمت ← رسالة على الشاشة، والرجوع بيتفتح', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockData.updateTransaction = jest.fn(async () => { throw new Error('stage'); });
      mockSettleNow = false;
      await openEdit();
      await act(async () => { fireEvent.press(screen.getByTestId('tx_save_button')); });
      await act(async () => { await mockSettleReply!([]); });
      expect(screen.getByTestId('tx_error')).toBeTruthy();
      await act(async () => { navRef.goBack(); });
      expect(routeNames()).toEqual(['root', 'home']);
    } finally { warn.mockRestore(); }
  });
});
