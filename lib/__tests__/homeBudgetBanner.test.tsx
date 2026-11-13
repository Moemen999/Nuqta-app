import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import HomeTab from '@/app/(tabs)/index';
import { HIDE_AMOUNTS_KEY, PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * بانر «الميزانية قربت تخلص / خلصت» بيعدّي على `budgetLevel` (نص قرش): الفرق التحت-قرش مبيطلعش «قربت» والرقم
 * اللي على الشاشة بيساوي الميزانية. القيم العادية متغيّرتش.
 */
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.c', emailVerified: true, providerData: [{ providerId: 'password' }], reload: async () => {} } }),
}));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/components/IncomeHomeCards', () => ({ __esModule: true, usePendingIncomes: () => [], default: () => null, IncomeAutoNotices: () => null }));
jest.mock('@/components/ChargeHomeCards', () => ({ __esModule: true, usePendingCharges: () => [], default: () => null, ChargeAutoNotices: () => null }));

const exp = (id: string, amount: number, categoryId?: string) => ({ id, type: 'expense', amount, walletId: 'w1', categoryId, date: '2026-11-13', createdAt: '2026-11-13T08:00:00Z' });

async function mount(transactions: unknown[], budgets: Record<string, number>) {
  await AsyncStorage.clear();
  await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, '0');
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 100000, lowAlert: 0 }], categories: [{ id: 'c1', name: 'أكل' }], transactions,
    budgets, subscriptions: [], gamiyas: [], incomes: [], debts: [], brokenTransactions: [], pendingTxIds: new Set(),
    serverReachable: true, setupStatus: 'done', loadErrors: [], transfersStatus: 'ready', figuresPending: [], figuresFromServer: true,
  });
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 10, 13, 12, 0, 0));
  await render(<ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>);
  await act(async () => { jest.advanceTimersByTime(3000); });
  jest.useRealTimers();
}

/**
 * بانر الميزانية الإجمالية اتشال (قرار مؤمن 2026-11-13): كارت الشهر (`home_month_card`) بيقول قربت/خلصت/عدّت من نفس `budgetLevel`.
 * كانت هنا 4 اختبارات على نص البانر («الميزانية الإجمالية قربت/خلصت») بنفس الأرقام الحدّية — اتحوّلت لنص الكارت (نفس الدرجات)،
 * وبتأكد إن مفيش بانر ولا سطر «محتاجة انتباهك» ظهر بداله.
 */
describe('الميزانية الإجمالية: الكارت بس، من غير بانر', () => {
  const noBanner = () => {
    expect(screen.queryByTestId('home_banner_budget_total')).toBeNull();
    expect(screen.queryByTestId('home_attention_line')).toBeNull();
    expect(screen.queryByText(/الميزانية الإجمالية/)).toBeNull();
  };
  const card = () => screen.getByTestId('home_month_card');

  it('799 من 1000 ← مفيش بانر ولا درجة في الكارت', async () => {
    await mount([exp('a', 799)], { total_budget: 1000 });
    noBanner();
    expect(within(card()).queryByText(/قربت تخلص|الميزانية خلصت|عدّيت الميزانية/)).toBeNull();
  });
  it('800 من 1000 ← الكارت «قربت تخلص»، ومفيش بانر', async () => {
    await mount([exp('a', 800)], { total_budget: 1000 });
    noBanner();
    expect(within(card()).getByText(/قربت تخلص/)).toBeTruthy();
  });
  it('999.996 من 1000 ← الكارت «الميزانية خلصت» (مش قربت) — الفرق نص قرش', async () => {
    await mount([exp('a', 999.996)], { total_budget: 1000 });
    noBanner();
    expect(within(card()).getByText('الميزانية خلصت')).toBeTruthy();
    expect(within(card()).queryByText(/قربت تخلص/)).toBeNull();
  });
  it('1000 بالظبط ← «الميزانية خلصت»، و1000.01 ← «عدّيت الميزانية»', async () => {
    await mount([exp('a', 1000)], { total_budget: 1000 });
    noBanner();
    expect(within(card()).getByText('الميزانية خلصت')).toBeTruthy();
    await mount([exp('a', 1000.01)], { total_budget: 1000 });
    noBanner();
    expect(within(card()).getByText(/عدّيت الميزانية/)).toBeTruthy();
  });
});

describe('ميزانية الفئة (بقت عنصر «محتاجة انتباهك» — واحد بس ← نصه في السطر نفسه)', () => {
  it('نفس الدرجات: 999.996 ← خلصت، 900 ← قربت', async () => {
    await mount([exp('a', 999.996, 'c1')], { c1: 1000 });
    expect(screen.getByText(/ميزانية أكل خلصت/)).toBeTruthy();
    await mount([exp('a', 900, 'c1')], { c1: 1000 });
    expect(screen.getByText(/ميزانية أكل قربت تخلص/)).toBeTruthy();
  });
});
