import React from 'react';
import { render, screen } from '@testing-library/react-native';
import ReportsTab from '@/app/(tabs)/reports';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * رسم التقارير بأعمدة أفقية (فرع `feat/report-bars`، مستني مؤمن): عمود لكل شريحة بنفس اسمها ونسبتها، والقارئ بيسمع
 * الاسم والنسبة في جملة. مفيش `PieChart` تاني في الشاشة.
 */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const today = new Date().toISOString().slice(0, 10);
beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }],
    categories: [{ id: 'c1', name: 'أكل' }, { id: 'c2', name: 'مواصلات' }],
    transactions: [
      { id: 't1', type: 'expense', amount: 300, date: today, walletId: 'w', categoryId: 'c1' },
      { id: 't2', type: 'expense', amount: 100, date: today, walletId: 'w', categoryId: 'c2' },
    ],
    debts: [], gamiyas: [], subscriptions: [], incomes: [], pendingTxIds: new Set(), serverReachable: true,
  });
});

it('عمود لكل فئة، بالنسبة من الإجمالي، والقارئ بيسمع الاسم والنسبة', async () => {
  await render(<ThemeProvider><PrivacyProvider><ReportsTab /></PrivacyProvider></ThemeProvider>);
  expect(screen.getByTestId('reports_bars')).toBeTruthy();
  expect(screen.getByTestId('reports_bar_c1').props.accessibilityLabel).toMatch(/أكل، 75% من المصروف$/);
  expect(screen.getByTestId('reports_bar_c2').props.accessibilityLabel).toMatch(/مواصلات، 25% من المصروف$/);
});
