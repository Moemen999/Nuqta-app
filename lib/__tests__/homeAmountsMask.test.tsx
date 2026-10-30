import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import HomeTab from '@/app/(tabs)/index';
import { HIDE_AMOUNTS_KEY, PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { MONEY_MASK } from '@/lib/money';

/**
 * العين للأرصدة بس (قرار مؤمن 2026-10-28، بيكمّل قرار 2026-09-27 "العين بتخبّي
 * الأرصدة في الرئيسية"): والعين مقفولة، الإجمالي ورصيد كل محفظة مخفيين، ومبلغ
 * كل عملية في "آخر العمليات" ظاهر. بانر "رصيد قرب يخلص" فيه رصيد ففاضل مخفي.
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

const tx = { id: 't1', type: 'expense', amount: 4321, walletId: 'w1', date: '2026-01-02', createdAt: '2026-01-02T08:00:00Z' };

beforeEach(async () => {
  await AsyncStorage.clear();
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    // رصيد كاش = 9000 − 4321 = 4679، وتحت حد التنبيه (5000) ← بانر "قرب يخلص"
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 9000, lowAlert: 5000 }], categories: [], transactions: [tx],
    budgets: {}, subscriptions: [], gamiyas: [], incomes: [], debts: [], pendingTxIds: new Set(),
    serverReachable: true, setupStatus: 'done', loadErrors: [],
  });
});

async function mount(hidden: boolean) {
  await AsyncStorage.setItem(HIDE_AMOUNTS_KEY, hidden ? '1' : '0');
  jest.useFakeTimers();
  await render(<ThemeProvider><PrivacyProvider><HomeTab /></PrivacyProvider></ThemeProvider>);
  await act(async () => { jest.advanceTimersByTime(3000); });
  jest.useRealTimers();
}

const txRow = () => within(screen.getByTestId('home_tx_t1'));

describe('العين مقفولة', () => {
  it('مبلغ العملية ظاهر في "آخر العمليات"', async () => {
    await mount(true);
    expect(txRow().getByText(/4,321/)).toBeTruthy();
    expect(txRow().queryByText(new RegExp(MONEY_MASK))).toBeNull();
  });
  it('الإجمالي ورصيد المحفظة مخفيين — الرقم الحقيقي مش على الشاشة خالص', async () => {
    await mount(true);
    expect(screen.queryByText(/4,679/)).toBeNull();
    expect(screen.getAllByText(MONEY_MASK).length).toBeGreaterThanOrEqual(2);
  });
  it('بانر "رصيد قرب يخلص" فاضل مخفي (رصيد مش عملية)', async () => {
    await mount(true);
    expect(screen.getByText(new RegExp(`قرب يخلص \\(${MONEY_MASK}`))).toBeTruthy();
  });
  it('قارئ الشاشة: البانر بيقول "مبلغ مخفي"، وصف العملية بيقول الرقم (a11y-architect)', async () => {
    await mount(true);
    // الـlabel على نص البانر (Text) مش على الـView
    const banner = within(screen.getByTestId('home_banner_low_w1')).getByText(/قرب يخلص/);
    expect(banner.props.accessibilityLabel).toContain('مبلغ مخفي');
    expect(banner.props.accessibilityLabel).not.toMatch(/4,679/);
    expect(txRow().getByText(/4,321/).props.accessibilityLabel ?? '').not.toContain('مبلغ مخفي');
  });
});

it('العين مفتوحة ← كله ظاهر زي الأول', async () => {
  await mount(false);
  expect(txRow().getByText(/4,321/)).toBeTruthy();
  expect(screen.getAllByText(/4,679/).length).toBeGreaterThanOrEqual(1);
});

it('العين: الاسم والشرح بيقولوا اللي بيتخبّى واللي بيفضل ظاهر', async () => {
  await mount(true);
  const eye = screen.getByTestId('home_hide_amounts_toggle');
  expect(eye.props.accessibilityLabel).toBe('إخفاء الأرصدة والمبالغ');
  expect(eye.props.accessibilityHint).toBe('في الرئيسية بس — مبالغ آخر العمليات بتفضل ظاهرة');
});
