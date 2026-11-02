import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
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
    budgets: {}, subscriptions: [], gamiyas: [], incomes: [], debts: [], pendingTxIds: new Set(),
    serverReachable: true, setupStatus: 'done', loadErrors: [],
    ...over,
  });
}

async function mount() {
  jest.useFakeTimers();
  // "لسه ما سجلتش" بيظهر بعد ساعة التذكير بس (الافتراضي 8 م) — نفس اليوم، الساعة 9 م
  const now = new Date();
  jest.setSystemTime(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0));
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
});

it('مفيش coldSnapshot ← مفيش بانر قديم ولا صفوف كاش', async () => {
  setData({ coldSnapshot: null });
  await mount();
  expect(screen.queryByTestId('home_banner_cold')).toBeNull();
  expect(screen.queryByTestId('home_cold_tx_c1')).toBeNull();
});
