import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
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

describe('بانر الميزانية الإجمالية', () => {
  it('799 من 1000 ← مفيش بانر، و800 ← «قربت تخلص»', async () => {
    await mount([exp('a', 799)], { total_budget: 1000 });
    expect(screen.queryByTestId('home_banner_budget_total')).toBeNull();
  });
  it('800 من 1000 ← قربت تخلص', async () => {
    await mount([exp('a', 800)], { total_budget: 1000 });
    expect(screen.getByText(/الميزانية الإجمالية قربت تخلص/)).toBeTruthy();
  });
  it('999.996 من 1000 ← خلصت (مش قربت) — الفرق نص قرش', async () => {
    await mount([exp('a', 999.996)], { total_budget: 1000 });
    expect(screen.getByText(/الميزانية الإجمالية خلصت/)).toBeTruthy();
    expect(screen.queryByText(/الميزانية الإجمالية قربت تخلص/)).toBeNull();
  });
  it('1000 بالظبط ← خلصت، و1000.01 ← خلصت', async () => {
    await mount([exp('a', 1000)], { total_budget: 1000 });
    expect(screen.getByText(/الميزانية الإجمالية خلصت/)).toBeTruthy();
    await mount([exp('a', 1000.01)], { total_budget: 1000 });
    expect(screen.getByText(/الميزانية الإجمالية خلصت/)).toBeTruthy();
  });
});

describe('بانر ميزانية الفئة', () => {
  it('نفس الدرجات: 999.996 ← خلصت، 900 ← قربت', async () => {
    await mount([exp('a', 999.996, 'c1')], { c1: 1000 });
    expect(screen.getByText(/ميزانية أكل خلصت/)).toBeTruthy();
    await mount([exp('a', 900, 'c1')], { c1: 1000 });
    expect(screen.getByText(/ميزانية أكل قربت تخلص/)).toBeTruthy();
  });
});
