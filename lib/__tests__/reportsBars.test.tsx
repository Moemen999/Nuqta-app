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

it('عمود لكل فئة، بالنسبة من الإجمالي، والنسبة ليها جملة لقارئ الشاشة', async () => {
  await render(<ThemeProvider><PrivacyProvider><ReportsTab /></PrivacyProvider></ThemeProvider>);
  expect(screen.getByTestId('reports_bars')).toBeTruthy();
  expect(screen.getByLabelText('75 بالمية من المصروف')).toBeTruthy();
  expect(screen.getByLabelText('25 بالمية من المصروف')).toBeTruthy();
});

it('الصف مش عنصر واحد (a11y-architect BLOCKER): المبلغ والاسم كل واحد محطة لوحده — Money ما اتبلعش', async () => {
  await render(<ThemeProvider><PrivacyProvider><ReportsTab /></PrivacyProvider></ThemeProvider>);
  const row = screen.getByTestId('reports_bar_c1');
  expect(row.props.accessible).toBeFalsy();
  expect(row.props.accessibilityLabel).toBeUndefined();
  // المبلغ نفسه موجود كنص جوه الصف (مش مكتوب في label الصف)
  expect(screen.getAllByText(/300/).length).toBeGreaterThan(0);
});

describe('رسم الاتجاه (آخر 6 شهور)', () => {
  const thisMonth = today.slice(0, 7);
  it('6 أعمدة، والشهر ده فيه مصروفه، والعمود زخرفي', async () => {
    await render(<ThemeProvider><PrivacyProvider><ReportsTab /></PrivacyProvider></ThemeProvider>);
    expect(screen.getByTestId('reports_trend')).toBeTruthy();
    expect(screen.getByTestId(`reports_trend_${thisMonth}`)).toBeTruthy();
    expect(screen.getByTestId('reports_trend').children.length).toBe(6);
    expect(screen.getByText('الشهر ده لسه ما خلصش، فعموده محسوب لحد النهارده بس')).toBeTruthy();
    // القارئ بيعرف أنهي شهر لسه ما خلصش (الإشارة مش بصرية بس)
    expect(screen.getByLabelText(/، لسه ما خلصش$/)).toBeTruthy();
  });

  it('السلفة مش في الاتجاه (نفس spendingExpenses)', async () => {
    Object.assign(mockData, {
      transactions: [{ id: 'loan', type: 'expense', amount: 500, date: today, walletId: 'w' }],
      debts: [{ id: 'd', personName: 'أ', totalAmount: 500, direction: 'owed_to_me', payments: [], initialTransactionId: 'loan', date: today }],
    });
    await render(<ThemeProvider><PrivacyProvider><ReportsTab /></PrivacyProvider></ThemeProvider>);
    expect(screen.queryByTestId('reports_trend')).toBeNull();
    expect(screen.getByText('مفيش مصاريف في آخر 6 شهور')).toBeTruthy();
  });
});
