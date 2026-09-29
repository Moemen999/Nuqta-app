import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import TabLayout from '@/app/(tabs)/_layout';
import HomeTab from '@/app/(tabs)/index';
import AddTransactionModal from '@/app/modal';
import PendingSummary from '@/components/PendingSheet';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { pendingSummaryPhrase } from '@/lib/pendingSummary';

/**
 * جرد الرئيسية بعد إعادة الترتيب (2026-09-29) — نفس فكرة
 * `settingsScreenInventory.test.tsx`: اللي لازم يفضل موجود بيتثبّت هنا، عشان
 * نقل جاي ميضيّعش حاجة من غير ما حد يحس.
 *
 * - "+" ظاهر من غير ولا عملية، ومن غير ولا محفظة.
 * - صيغ سطر "مستنيين ردك" لـ 0/1/2/5/15.
 * - بانر "مقدرناش نجيب بياناتك" ورسايل "ما سجلناش" **مش** جوه الشيت.
 * - شاشة العملية من غير محفظة فيها زرار بيعمل محفظة.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockPath = '/';
jest.mock('expo-router', () => {
  const Tabs = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Tabs.Screen = () => null;
  // بالدالة مش بالكائن: الـmock بيتنادى قبل ما `mockRouter` يتعرّف (jest.mock بيطلع فوق)
  const router = {
    push: (...a: unknown[]) => mockRouter.push(...a),
    replace: (...a: unknown[]) => mockRouter.replace(...a),
    back: (...a: unknown[]) => mockRouter.back(...a),
  };
  return { Tabs, usePathname: () => mockPath, router, useLocalSearchParams: () => ({}) };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'تجربة', emailVerified: true, providerData: [], reload: async () => {} } }),
}));

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

// عدد الكروت المستنية وشكلها متحكّم فيه من هنا — الكروت نفسها ليها اختباراتها
let mockPendingIncomes = 0;
let mockPendingCharges: { kind: 'subscription' | 'gamiya' }[] = [];
let mockAutoError = false;
jest.mock('@/components/IncomeHomeCards', () => {
  const { Text: T } = require('react-native');
  return {
    __esModule: true,
    usePendingIncomes: () => Array.from({ length: mockPendingIncomes }, (_, i) => ({ inc: { id: `i${i}` }, keys: ['k'] })),
    default: () => <T testID="income_cards">كروت نزل؟</T>,
    IncomeAutoNotices: () => (mockAutoError ? <T testID="auto_notice_error">{'ما سجلناش "المرتب"'}</T> : null),
  };
});
jest.mock('@/components/ChargeHomeCards', () => {
  const { Text: T } = require('react-native');
  return {
    __esModule: true,
    usePendingCharges: () => mockPendingCharges,
    default: ({ kind }: { kind?: string }) => <T testID={`charge_cards_${kind}`}>كروت {kind}</T>,
    ChargeAutoNotices: () => null,
  };
});

const wallet = { id: 'w1', name: 'كاش', openingBalance: 1000, lowAlert: 0 };

function setData(over: Record<string, unknown> = {}) {
  Object.assign(mockData, {
    wallets: [wallet], categories: [], transactions: [], budgets: {}, subscriptions: [], gamiyas: [], incomes: [],
    debts: [], pendingTxIds: new Set(), serverReachable: true, setupStatus: 'done', loadErrors: [],
    addTransaction: jest.fn(), updateTransaction: jest.fn(), deleteTransaction: jest.fn(),
    transactionLinkWarning: () => null,
    ...over,
  });
}

beforeEach(() => {
  setData();
  mockPath = '/';
  mockPendingIncomes = 0;
  mockPendingCharges = [];
  mockAutoError = false;
  Object.values(mockRouter).forEach(f => f.mockClear());
});

const mountTabs = () => render(<ThemeProvider><TabLayout /></ThemeProvider>);
const mountHome = () => render(<ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>);

describe('الزرار "+"', () => {
  it('من غير ولا عملية ← ظاهر في الرئيسية', async () => {
    await mountTabs();
    expect(screen.getByTestId('tx_add_button')).toBeTruthy();
  });

  it('من غير ولا محفظة (السيرفر متأكد) ← ظاهر في الرئيسية', async () => {
    setData({ wallets: [] });
    await mountTabs();
    expect(screen.getByTestId('tx_add_button')).toBeTruthy();
  });

  it('فيه كروت مستنية ← لسه ظاهر', async () => {
    mockPendingIncomes = 3;
    await mountTabs();
    expect(screen.getByTestId('tx_add_button')).toBeTruthy();
  });

  it('الدوسة بتفتح شاشة العملية', async () => {
    await mountTabs();
    fireEvent.press(screen.getByTestId('tx_add_button'));
    expect(mockRouter.push).toHaveBeenCalledWith('/modal');
  });
});

describe('سطر "مستنيين ردك" — الصيغ بالنص', () => {
  it.each([
    [0, null],
    [1, 'عندك حاجة مستنية ردك'],
    [2, 'عندك حاجتين مستنيين ردك'],
    [5, 'عندك 5 حاجات مستنيين ردك'],
    [15, 'عندك 15 حاجة مستنيين ردك'],
  ])('%i ← %s', (n, phrase) => {
    expect(pendingSummaryPhrase(n)).toBe(phrase);
  });

  it('الحدود: 3 و10 "حاجات"، 11 "حاجة"', () => {
    expect(pendingSummaryPhrase(3)).toBe('عندك 3 حاجات مستنيين ردك');
    expect(pendingSummaryPhrase(10)).toBe('عندك 10 حاجات مستنيين ردك');
    expect(pendingSummaryPhrase(11)).toBe('عندك 11 حاجة مستنيين ردك');
  });

  it('صفر ← السطر مش موجود خالص في الرئيسية', async () => {
    await mountHome();
    expect(screen.queryByTestId('home_pending_summary')).toBeNull();
  });

  it.each([
    [1, 0, 'عندك حاجة مستنية ردك'],
    [1, 1, 'عندك حاجتين مستنيين ردك'],
    [2, 3, 'عندك 5 حاجات مستنيين ردك'],
    [5, 10, 'عندك 15 حاجة مستنيين ردك'],
  ])('%i دخل + %i اشتراك/جمعية ← "%s" في الرئيسية', async (inc, ch, phrase) => {
    mockPendingIncomes = inc;
    mockPendingCharges = Array.from({ length: ch }, (_, i) => ({ kind: i % 2 ? 'gamiya' : 'subscription' }));
    await mountHome();
    expect(screen.getByTestId('home_pending_summary')).toBeTruthy();
    expect(screen.getByText(phrase)).toBeTruthy();
  });

  it('الدوسة بتفتح الشيت متقسم بالنوع', async () => {
    mockPendingIncomes = 1;
    mockPendingCharges = [{ kind: 'subscription' }, { kind: 'gamiya' }];
    await render(<ThemeProvider><PendingSummary /></ThemeProvider>);
    expect(screen.queryByTestId('pending_sheet')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('home_pending_summary')); });
    const sheet = within(screen.getByTestId('pending_sheet'));
    expect(sheet.getByText('الدخل الثابت')).toBeTruthy();
    expect(sheet.getByText('الاشتراكات')).toBeTruthy();
    expect(sheet.getByText('الجمعية')).toBeTruthy();
    expect(sheet.getByTestId('income_cards')).toBeTruthy();
    expect(sheet.getByTestId('charge_cards_subscription')).toBeTruthy();
    expect(sheet.getByTestId('charge_cards_gamiya')).toBeTruthy();
  });
});

describe('بانرات الخطأ مش جوه الشيت', () => {
  it('"ما سجلناش" ظاهر في الرئيسية والشيت مقفول — ومش جوه الشيت لما يتفتح', async () => {
    mockAutoError = true;
    mockPendingIncomes = 1;
    await mountHome();
    expect(screen.getByTestId('auto_notice_error')).toBeTruthy();
    expect(screen.queryByTestId('pending_sheet')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('home_pending_summary')); });
    expect(within(screen.getByTestId('pending_sheet')).queryByTestId('auto_notice_error')).toBeNull();
    expect(screen.getByTestId('auto_notice_error')).toBeTruthy();
  });

  it('listener اترفض ← الشيت مبيعرضش بانر الخطأ (مكانه فوق الـStack كله)', async () => {
    setData({ loadErrors: ['transactions'] });
    mockPendingIncomes = 1;
    await render(<ThemeProvider><PendingSummary /></ThemeProvider>);
    await act(async () => { fireEvent.press(screen.getByTestId('home_pending_summary')); });
    expect(within(screen.getByTestId('pending_sheet')).queryByTestId('data_load_error_banner')).toBeNull();
  });

  it('المصدر: بانر "مقدرناش نجيب بياناتك" في الـlayout الجذري، والشيت مبيستوردش أي بانر خطأ', () => {
    const root = path.join(__dirname, '..', '..');
    const layout = fs.readFileSync(path.join(root, 'app', '_layout.tsx'), 'utf8');
    const sheet = fs.readFileSync(path.join(root, 'components', 'PendingSheet.tsx'), 'utf8');
    const home = fs.readFileSync(path.join(root, 'app', '(tabs)', 'index.tsx'), 'utf8');
    expect(layout).toMatch(/<DataLoadErrorBanner \/>/);
    expect(sheet).not.toMatch(/import[^\n]*(DataLoadErrorBanner|AutoNotices)/);
    expect(sheet).not.toMatch(/loadErrors/);
    // رسايل التلقائي متركّبة في الرئيسية نفسها — وهي اللي بتشغّل التسجيل التلقائي
    expect(home).toMatch(/<IncomeAutoNotices \/>/);
    expect(home).toMatch(/<ChargeAutoNotices \/>/);
  });
});

describe('شاشة العملية من غير محفظة', () => {
  it('فيها رسالة وزرار "ضيف محفظة" بيودّي لشاشة المحافظ', async () => {
    setData({ wallets: [] });
    await render(<ThemeProvider><AddTransactionModal /></ThemeProvider>);
    expect(screen.getByTestId('tx_no_wallets')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('tx_no_wallets_add')); });
    expect(mockRouter.replace).toHaveBeenCalledWith('/settings-screens/wallets');
  });

  it('كل المحافظ متأرشفة ← نفس الزرار', async () => {
    setData({ wallets: [{ ...wallet, archived: true }] });
    await render(<ThemeProvider><AddTransactionModal /></ThemeProvider>);
    expect(screen.getByTestId('tx_no_wallets_add')).toBeTruthy();
  });

  it('فيه محفظة ← مفيش الرسالة', async () => {
    await render(<ThemeProvider><AddTransactionModal /></ThemeProvider>);
    expect(screen.queryByTestId('tx_no_wallets')).toBeNull();
  });
});
