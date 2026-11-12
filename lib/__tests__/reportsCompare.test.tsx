import React from 'react';
import { render, screen } from '@testing-library/react-native';
import ReportsTab from '@/app/(tabs)/reports';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * «الشهر ده» بيتقارن بنفس الأيام من الشهر اللي فات، مش بشهر كامل (مقاس على جهاز 2026-11-12:
 * 5,333 في 1–12 نوفمبر قصاد 3,775 في 1–12 أكتوبر = +41%، مش -25% من مقارنة بـ30 يوم).
 */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

// الساعة بس اللي متثبّتة — المؤقتات حقيقية عشان الـrender
beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-12T09:00:00'), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
  for (const k of Object.keys(mockData)) delete mockData[k];
  const exp = (id: string, amount: number, date: string) => ({ id, type: 'expense', amount, date, walletId: 'w', categoryId: 'c1' });
  Object.assign(mockData, {
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }],
    categories: [{ id: 'c1', name: 'أكل' }],
    transactions: [
      exp('o1', 3775, '2026-10-05'),
      exp('o2', 3370, '2026-10-20'),
      exp('n1', 5333, '2026-11-12'),
      // عملية تاريخها جاي: متدخلش في النسبة
      exp('n2', 9000, '2026-11-25'),
    ],
    debts: [], gamiyas: [], subscriptions: [], incomes: [], pendingTxIds: new Set(), serverReachable: true,
  });
});
afterEach(() => jest.useRealTimers());

it('الشهر ده: +41% بنص المقارنة بنفس الأيام، مش -25%', async () => {
  await render(<ThemeProvider><PrivacyProvider><ReportsTab /></PrivacyProvider></ThemeProvider>);
  expect(screen.getByText('مقارنة بنفس الأيام من الشهر اللي فات')).toBeTruthy();
  expect(screen.getByText('+41%')).toBeTruthy();
  expect(screen.queryByText('-25%')).toBeNull();
  expect(screen.queryByText('مقارنة بالفترة اللي قبلها')).toBeNull();
});
