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
 * قرارات مؤمن على مودال العملية (2026-11-19، «موافق علي ترشيحاتك»):
 * - المسح: العنوان «تمسح العملية؟»، والزرار في الفوتر وفي التأكيد وفي شيت التسوية «امسحها» (كان «حذف»).
 * - النوع «سحب» اتسمّى «تحويل» في كل حتة بيتعرض فيها (القيمة المتخزّنة لسه `withdraw`).
 * - كتبت أو غيّرت حاجة وخرجت (رجوع أندرويد، سحب المودال، «إلغاء») ← سؤال «فيه حاجة ما اتحفظتش، تخرج؟» («اخرج» / «كمّل»).
 *   مش بعد حفظ أو مسح نجح، ومش وقت الحفظ (المنع بتاعه شغال)، والتطبيق اتقفل والسؤال مفتوح ← بيتلغي (ConfirmProvider).
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
    wallets: [wallet], categories: [], transactions: [], brokenTransactions: [], debts: [], subscriptions: [], gamiyas: [], incomes: [],
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


const existingTx = { id: 't1', type: 'expense', amount: 30, walletId: 'w1', date: '2026-11-17' };
async function openModal(edit = false) {
  if (edit) { mockParams = { id: 't1' }; mockData.transactions = [existingTx]; }
  await render(<App />);
  await act(async () => { navRef.navigate('home'); });
  await act(async () => { navRef.navigate('modal'); });
  await act(async () => {});
  expect(routeNames()).toEqual(['root', 'home', 'modal']);
}
const LEAVE_TITLE = 'فيه حاجة ما اتحفظتش، تخرج؟';

describe('7) المسح: «تمسح العملية؟» و«امسحها»', () => {
  it('زرار الفوتر «امسحها»، والتأكيد عنوانه «تمسح العملية؟» وزراره «امسحها»', async () => {
    await openModal(true);
    expect(screen.getByTestId('tx_delete_button')).toBeTruthy();
    expect(screen.queryByText('حذف')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('tx_delete_button')); });
    expect(screen.getByTestId('confirm_title').props.children).toBe('تمسح العملية؟');
    expect(screen.getByTestId('confirm_action_0')).toHaveTextContent('امسحها');
  });
});

describe('8) «سحب» ← «تحويل»', () => {
  it('شريحة النوع «تحويل»، ومفيش «سحب» في الشاشة', async () => {
    await openModal();
    expect(screen.getByTestId('tx_type_withdraw')).toHaveTextContent('تحويل');
    expect(screen.queryByText('سحب')).toBeNull();
  });
  it('TYPE_LABELS (الأرشيف والرئيسية والتصدير) «تحويل»، والقيمة المتخزّنة لسه withdraw', () => {
    const { TYPE_LABELS } = require('@/lib/finance');
    expect(TYPE_LABELS.withdraw.label).toBe('تحويل');
    const { TX_TYPE_WORD } = require('@/lib/txRowLabel');
    expect(TX_TYPE_WORD.withdraw).toBe('تحويل');
  });
  it('دليل الاستخدام مبيقولش «سحب» كنوع عملية', () => {
    const src: string = require('fs').readFileSync('app/user-guide.tsx', 'utf8');
    expect(src).not.toMatch(/سحب \(تحويل/);
    expect(src).toContain('تحويل (بين محفظتين');
  });
});

describe('9) تحذير قبل الخروج من غير حفظ', () => {
  it('مكتبش حاجة ← الرجوع عادي من غير سؤال', async () => {
    await openModal();
    await act(async () => { navRef.goBack(); });
    expect(routeNames()).toEqual(['root', 'home']);
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
  });

  it('كتب مبلغ ورجع ← السؤال؛ «كمّل» بيفضّل المودال والمبلغ زي ما هو', async () => {
    await openModal();
    await act(async () => { fireEvent.changeText(screen.getByTestId('tx_amount_input'), '50'); });
    await act(async () => { navRef.goBack(); });
    expect(routeNames()).toEqual(['root', 'home', 'modal']);
    expect(screen.getByTestId('confirm_title').props.children).toBe(LEAVE_TITLE);
    expect(screen.getByTestId('confirm_action_0')).toHaveTextContent('اخرج');
    expect(screen.getByTestId('confirm_cancel')).toHaveTextContent('كمّل');
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_cancel')); });
    expect(routeNames()).toEqual(['root', 'home', 'modal']);
    expect(screen.getByTestId('tx_amount_input').props.value).toBe('50');
  });

  it('«اخرج» ← المودال بيتقفل مرة واحدة والشاشة اللي ورا فاضلة، ومفيش حفظ', async () => {
    await openModal();
    await act(async () => { fireEvent.changeText(screen.getByTestId('tx_amount_input'), '50'); });
    await act(async () => { fireEvent.press(screen.getByText('إلغاء')); });
    expect(screen.getByTestId('confirm_title').props.children).toBe(LEAVE_TITLE);
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
    expect(routeNames()).toEqual(['root', 'home']);
    expect(mockData.addTransaction).not.toHaveBeenCalled();
  });

  it('تعديل: غيّر الملاحظة ورجع ← السؤال (جملة التعديل)', async () => {
    await openModal(true);
    await act(async () => { fireEvent.changeText(screen.getByLabelText('ملاحظة'), 'جديد'); });
    await act(async () => { navRef.goBack(); });
    expect(screen.getByTestId('confirm_title').props.children).toBe(LEAVE_TITLE);
    expect(screen.getByTestId('confirm_body').props.children).toBe('لو خرجت، التعديل مش هيتحفظ والعملية هتفضل زي ما هي.');
  });

  it('دوس على النوع اللي مختار أصلاً ← مش تغيير، الرجوع عادي', async () => {
    await openModal();
    await act(async () => { fireEvent.press(screen.getByTestId('tx_type_expense')); });
    await act(async () => { navRef.goBack(); });
    expect(routeNames()).toEqual(['root', 'home']);
  });

  it('غيّر النوع ← السؤال', async () => {
    await openModal();
    await act(async () => { fireEvent.press(screen.getByTestId('tx_type_income')); });
    await act(async () => { navRef.goBack(); });
    expect(screen.getByTestId('confirm_title').props.children).toBe(LEAVE_TITLE);
  });

  it('بعد حفظ نجح ← الرجوع من غير سؤال (مرة واحدة)', async () => {
    await openModal();
    await act(async () => { fireEvent.changeText(screen.getByTestId('tx_amount_input'), '50'); });
    await act(async () => { fireEvent.press(screen.getByTestId('tx_save_button')); });
    // وقت الحفظ: المنع بتاع الحفظ هو اللي شغال، مش السؤال
    await act(async () => { navRef.goBack(); });
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
    expect(routeNames()).toEqual(['root', 'home', 'modal']);
    await act(async () => { resolveAdd(); });
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(routeNames()).toEqual(['root', 'home']);
  });

  it('بعد مسح نجح (وكان غيّر حاجة) ← الرجوع من غير سؤال', async () => {
    mockData.deleteTransaction = jest.fn(async () => ({ outcome: 'done' }));
    await openModal(true);
    await act(async () => { fireEvent.changeText(screen.getByLabelText('ملاحظة'), 'جديد'); });
    await act(async () => { fireEvent.press(screen.getByTestId('tx_delete_button')); });
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
    expect(mockData.deleteTransaction).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
    expect(routeNames()).toEqual(['root', 'home']);
  });
});
