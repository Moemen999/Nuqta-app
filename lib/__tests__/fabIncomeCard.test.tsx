import React from 'react';
import { render, screen } from '@testing-library/react-native';
import TabLayout from '@/app/(tabs)/_layout';
import { ThemeProvider } from '@/context/ThemeContext';
import { todayStr } from '@/lib/finance';

/**
 * الزرار العايم "+" كان بيقعد فوق زرار "ما نزلش" في كارت الدخل الثابت
 * (اتشاف على الجهاز 2026-09-26). بيستخبّى في الرئيسية بس، وبس طول ما فيه كارت.
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
const mockData: { incomes: unknown[] } = { incomes: [] };
jest.mock('@/context/DataContext', () => ({ useData: () => mockData }));

const mount = () => render(<ThemeProvider><TabLayout /></ThemeProvider>);

describe('الزرار العايم وكارت "نزل؟"', () => {
  beforeEach(() => { mockData.incomes = []; mockPath = '/'; });

  it('مفيش كارت ← الزرار ظاهر في الرئيسية', async () => {
    await mount();
    expect(screen.getByTestId('tx_add_button')).toBeTruthy();
  });

  it('فيه كارت "نزل؟" ← الزرار مستخبّي في الرئيسية', async () => {
    mockData.incomes = [pendingIncome];
    await mount();
    expect(screen.queryByTestId('tx_add_button')).toBeNull();
  });

  it('فيه كارت، بس في التقارير ← الزرار ظاهر (الكارت في الرئيسية بس)', async () => {
    mockData.incomes = [pendingIncome];
    mockPath = '/reports';
    await mount();
    expect(screen.getByTestId('tx_add_button')).toBeTruthy();
  });

  it('دخل "بيتسجل لوحده" مش بيطلع كارت ← الزرار ظاهر', async () => {
    mockData.incomes = [{ ...pendingIncome, mode: 'auto' }];
    await mount();
    expect(screen.getByTestId('tx_add_button')).toBeTruthy();
  });
});
