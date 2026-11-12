import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
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
  // +101% هو اللي كانت القاعدة القديمة بتدّيه على نفس البيانات
  expect(screen.queryByText('+101%')).toBeNull();
  expect(screen.queryByText('مقارنة بالفترة اللي قبلها')).toBeNull();
  // الرقم البطل فيه العملية اللي تاريخها جاي (5,333 + 9,000)، والنسبة لأ — الفرق ده مقصود
  expect(screen.getAllByText(/14,333/).length).toBeGreaterThan(0);
});

const exp = (id: string, amount: number, date: string, categoryId: string | undefined = 'c1') =>
  ({ id, type: 'expense', amount, date, walletId: 'w', categoryId });
const renderScreen = () => render(<ThemeProvider><PrivacyProvider><ReportsTab /></PrivacyProvider></ThemeProvider>);

it('فلتر فئة: النسبة من الفئة المختارة بس في الفترتين', async () => {
  mockData.categories = [{ id: 'c1', name: 'أكل' }, { id: 'c2', name: 'مواصلات' }];
  mockData.transactions = [
    exp('o1', 1000, '2026-10-05', 'c1'), exp('o2', 500, '2026-10-06', 'c2'),
    exp('n1', 1500, '2026-11-12', 'c1'), exp('n2', 100, '2026-11-10', 'c2'),
  ];
  await renderScreen();
  // من غير فلتر: 1,600 قصاد 1,500
  expect(screen.getByText('+7%')).toBeTruthy();
  await fireEvent.press(screen.getAllByText(/أكل/)[0]);
  // أكل بس: 1,500 قصاد 1,000
  expect(screen.getByText('+50%')).toBeTruthy();
  expect(screen.queryByText('+7%')).toBeNull();
});

it('سلفة وقسط جمعية جوه الفترة الحالية مش داخلين في النسبة', async () => {
  mockData.debts = [{ id: 'd1', direction: 'owed_to_me', initialTransactionId: 'dbt1', payments: [], increases: [] }];
  mockData.gamiyas = [{ id: 'g1', months: [{ transactionId: 'gm1' }] }];
  mockData.transactions = [
    exp('o1', 1000, '2026-10-05'),
    exp('n1', 1200, '2026-11-12'),
    exp('dbt1', 5000, '2026-11-10', undefined),
    exp('gm1', 700, '2026-11-11', undefined),
  ];
  await renderScreen();
  expect(screen.getByText('+20%')).toBeTruthy();
});

it('الشهر اللي فات: بيتقارن بالشهر اللي قبله كله وبالنص ده', async () => {
  mockData.transactions = [exp('s1', 2000, '2026-09-15'), exp('o1', 3775, '2026-10-05'), exp('o2', 3370, '2026-10-20')];
  await renderScreen();
  await fireEvent.press(screen.getByTestId('reports_preset_lastMonth'));
  expect(screen.getByText('مقارنة بالشهر اللي قبله')).toBeTruthy();
  expect(screen.getByText('+257%')).toBeTruthy();
  expect(screen.queryByText('مقارنة بالفترة اللي قبلها')).toBeNull();
});
