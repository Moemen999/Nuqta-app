import React from 'react';
import { render, screen } from '@testing-library/react-native';
import TabLayout from '@/app/(tabs)/_layout';
import { ThemeProvider } from '@/context/ThemeContext';
import { todayStr } from '@/lib/finance';

/**
 * الزرار العايم "+" **ظاهر دايمًا** في الرئيسية والتقارير والتخطيط (2026-09-29).
 * كان بيستخبّى طول ما فيه كارت "نزل؟"/"اتخصم؟" أو مفيش ولا محفظة، والمستخدم
 * اللي فاتح يسجل بسرعة مكانش لاقيه. الكروت هي اللي بتتنقل، مش الزرار.
 */

let mockPath = '/';
jest.mock('expo-router', () => {
  const Tabs = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  Tabs.Screen = () => null;
  return { Tabs, usePathname: () => mockPath, router: { push: jest.fn() } };
});

const today = todayStr();
const pendingIncome = {
  id: 'i1', name: 'المرتب', amount: 4000, walletId: 'w1', frequency: 'monthly', mode: 'confirm',
  status: 'active', dayOfMonth: Number(today.slice(8, 10)), startDate: `${today.slice(0, 7)}-01`, closed: {},
};
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));

const mount = () => render(<ThemeProvider><TabLayout /></ThemeProvider>);

describe('الزرار العايم "+" ظاهر دايمًا', () => {
  beforeEach(() => {
    Object.assign(mockData, {
      incomes: [], subscriptions: [], gamiyas: [], wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }],
      serverReachable: true, setupStatus: 'done', loadErrors: [],
    });
    mockPath = '/';
  });

  it('مفيش كارت ← الزرار ظاهر في الرئيسية', async () => {
    await mount();
    expect(screen.getByTestId('tx_add_button')).toBeTruthy();
  });

  it('فيه كارت "نزل؟" ← الزرار لسه ظاهر في الرئيسية', async () => {
    mockData.incomes = [pendingIncome];
    await mount();
    expect(screen.getByTestId('tx_add_button')).toBeTruthy();
  });

  it('فيه كارت "اتخصم؟" ← الزرار لسه ظاهر في الرئيسية', async () => {
    mockData.subscriptions = [{ id: 's1', name: 'نتفليكس', amount: 200, walletId: 'w1', frequency: 'monthly', nextDueDate: today, active: true, history: [] }];
    await mount();
    expect(screen.getByTestId('tx_add_button')).toBeTruthy();
  });

  it('مفيش ولا محفظة (متأكدين) ← الزرار ظاهر في الرئيسية والتقارير والتخطيط', async () => {
    mockData.wallets = [];
    for (const p of ['/', '/reports', '/planning']) {
      mockPath = p;
      await mount();
      expect(screen.getByTestId('tx_add_button')).toBeTruthy();
    }
  });

  it('الديون والإعدادات ← مفيش زرار (ليهم زراير إضافة بتاعتهم)', async () => {
    for (const p of ['/debts', '/settings']) {
      mockPath = p;
      await mount();
      expect(screen.queryByTestId('tx_add_button')).toBeNull();
    }
  });
});
