import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import HomeTab from '@/app/(tabs)/index';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { COLD_CACHE_VERSION } from '@/lib/coldCache';

/**
 * كاش أول فتحة باردة في الرئيسية (`reports/2026-11-02-cold-cache-design.md`): لما `coldSnapshot` موجود (مفيش ولا
 * محفظة من الـlisteners)، الرصيد والشرايح وآخر العمليات بيتعرضوا منه، **ببانر "قديم" من غير ✕**، والصفوف
 * مبتفتحش المودال، ومن غير "مفيش ولا محفظة".
 */
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
let mockVerified = true;
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      uid: 'u1', email: 'a@b.c', emailVerified: mockVerified,
      providerData: [{ providerId: 'password' }], reload: async () => {},
    },
    resendVerificationEmail: jest.fn(),
  }),
}));

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

// "ما سجلناش" من غير ما نشغّل التسجيل التلقائي الحقيقي — الكروت نفسها ليها اختباراتها
let mockAutoError = false;
jest.mock('@/components/IncomeHomeCards', () => {
  const { Text: T } = require('react-native');
  return {
    __esModule: true,
    usePendingIncomes: () => [],
    default: () => null,
    IncomeAutoNotices: () => (mockAutoError ? <T testID="income_notice_error">{'ما سجلناش "المرتب"'}</T> : null),
  };
});
jest.mock('@/components/ChargeHomeCards', () => ({
  __esModule: true, usePendingCharges: () => [], default: () => null, ChargeAutoNotices: () => null,
}));

const tx = { id: 't1', type: 'expense', amount: 50, walletId: 'w1', date: '2026-01-02', createdAt: '2026-01-02T08:00:00Z' };

function setData(over: Record<string, unknown>) {
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 1000, lowAlert: 0 }], categories: [], transactions: [tx],
    budgets: {}, subscriptions: [], gamiyas: [], incomes: [], debts: [], brokenTransactions: [], pendingTxIds: new Set(),
    serverReachable: true, setupStatus: 'done', loadErrors: [],
    ...over,
  });
}

async function mount() {
  jest.useFakeTimers();
  // "لسه ما سجلتش" بيظهر بعد ساعة التذكير بس (الافتراضي 8 م) — نفس اليوم، الساعة 9 م
  // يوم ثابت (13 نوفمبر 2026) عشان نص التاريخ («امبارح» / «31 أكتوبر») ميتغيّرش بتغيّر يوم الجهاز
  jest.setSystemTime(new Date(2026, 10, 13, 21, 0, 0));
  await render(<ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>);
  // "مفيش نت" بيستنى 2.5 ثانية عشان ميلمعش وإحنا بنحمّل
  await act(async () => { jest.advanceTimersByTime(3000); });
  jest.useRealTimers();
}


const cold = {
  v: COLD_CACHE_VERSION, uid: 'u1', savedAt: Date.parse('2026-11-01T18:30:00Z'),
  wallets: [{ id: 'w1', name: 'كاش', balance: 1200 }, { id: 'w2', name: 'بنك', balance: 3000.5 }],
  recent: [
    { id: 'c1', type: 'expense', amount: 40, walletId: 'w1', date: '2026-11-01', categoryId: 'k1' },
    { id: 'c2', type: 'expense', amount: 300, walletId: 'w1', date: '2026-10-31', kind: 'debt' },
    { id: 'c3', type: 'withdraw', amount: 100, walletId: 'w2', toWalletId: 'w1', date: '2026-10-30' },
  ],
  categories: [{ id: 'k1', name: 'أكل', icon: '🍔' }],
};

it('coldSnapshot موجود ← البانر، الإجمالي من الكاش، الشرايح، والصفوف من غير نوت', async () => {
  setData({ wallets: [], transactions: [], serverReachable: false, figuresFromServer: false, coldSnapshot: cold });
  await mount();
  expect(screen.getByTestId('home_banner_cold')).toBeTruthy();
  expect(screen.queryByTestId('home_banner_offline')).toBeNull();
  expect(screen.queryByTestId('home_no_wallets')).toBeNull();
  expect(screen.getByTestId('home_cold_wallet_w1')).toBeTruthy();
  expect(screen.getByTestId('home_cold_wallet_w2')).toBeTruthy();
  expect(screen.getByText(/4,?200\.5/)).toBeTruthy();
  expect(screen.getByTestId('home_cold_tx_c2')).toBeTruthy();
  expect(screen.getByText('دين')).toBeTruthy();
  expect(screen.getByText('من بنك إلى كاش')).toBeTruthy();
  // مبتفتحش المودال: مش زرار
  expect(screen.getByTestId('home_cold_tx_c1').props.onPress).toBeUndefined();
  // قارئ الشاشة: الإجمالي بيقول "قديم"، والصف عقدة واحدة أولها "قديم" (a11y-architect)
  expect(screen.getByText('إجمالي رصيدك (قديم)')).toBeTruthy();
  expect(screen.getByTestId('home_cold_tx_c2').props.accessibilityLabel).toMatch(/^قديم: دين، كاش، 300 جنيه، 31 أكتوبر$/);
});

it('صف الكاش: نفس يوم createdAt ← التاريخ والوقت، وتاريخ قبله بيومين ← التاريخ لوحده', async () => {
  const made = new Date(2026, 10, 1, 11, 34).toISOString(); // اتسجلت 1 نوفمبر 11:34 ص محلي
  const withTimes = {
    ...cold,
    recent: [
      { id: 'd1', type: 'expense', amount: 40, walletId: 'w1', date: '2026-11-01', createdAt: made },
      { id: 'd2', type: 'expense', amount: 50, walletId: 'w1', date: '2026-10-30', createdAt: made },
    ],
  };
  setData({ wallets: [], transactions: [], serverReachable: false, figuresFromServer: false, coldSnapshot: withTimes });
  await mount();
  expect(within(screen.getByTestId('home_cold_tx_d1')).getByText('1 نوفمبر · 11:34 ص')).toBeTruthy();
  const alone = within(screen.getByTestId('home_cold_tx_d2')).getByText('30 أكتوبر');
  expect(alone).toBeTruthy();
  expect(alone.props.children).not.toContain(' · ');
});

it('مفيش coldSnapshot ← مفيش بانر قديم ولا صفوف كاش', async () => {
  setData({ coldSnapshot: null });
  await mount();
  expect(screen.queryByTestId('home_banner_cold')).toBeNull();
  expect(screen.queryByTestId('home_cold_tx_c1')).toBeNull();
});

it('مسح الحساب ما خلصش ← بانر خطر من غير ✕، و"كمّل المسح" بيفتح الشاشة', async () => {
  const { router } = require('expo-router');
  const { fireEvent } = require('@testing-library/react-native');
  setData({ deletionPending: true });
  await mount();
  expect(screen.getByTestId('home_banner_delete_pending')).toBeTruthy();
  expect(screen.queryByTestId('home_banner_dismiss_delete_pending')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('home_delete_pending_go')); });
  expect(router.push).toHaveBeenCalledWith('/settings-screens/delete-account');
});

it('مفيش مسح معلّق ← مفيش بانر', async () => {
  setData({ deletionPending: false });
  await mount();
  expect(screen.queryByTestId('home_banner_delete_pending')).toBeNull();
});

it('الكاش في أول ثانيتين من الفتح ← «(قديم)» ظاهر، وبانر «مفيش نت» لسه لأ (ميلمعش والنت شغال)', async () => {
  setData({ coldSnapshot: cold });
  jest.useFakeTimers();
  const { AccessibilityInfo } = require('react-native');
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  await render(<ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>);
  await act(async () => { jest.advanceTimersByTime(1500); });
  expect(screen.getByText('إجمالي رصيدك (قديم)')).toBeTruthy();
  expect(screen.queryByTestId('home_banner_cold')).toBeNull();
  expect(announce.mock.calls.map(c => c[0])).toEqual([]);
  await act(async () => { jest.advanceTimersByTime(1500); });
  expect(screen.getByTestId('home_banner_cold')).toBeTruthy();
  // ظهر بعد المهلة ← بيتقال لقارئ الشاشة مرة
  expect(announce).toHaveBeenCalledTimes(1);
  expect(announce.mock.calls[0][0]).toContain('مفيش نت دلوقتي');
  jest.useRealTimers();
});
