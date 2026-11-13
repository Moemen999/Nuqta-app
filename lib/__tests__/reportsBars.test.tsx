import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import ReportsTab from '@/app/(tabs)/reports';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { todayStr } from '@/lib/finance';

/**
 * رسم التقارير بأعمدة أفقية (فرع `feat/report-bars`، مستني مؤمن): عمود لكل شريحة بنفس اسمها ونسبتها، والقارئ بيسمع
 * الاسم والنسبة في جملة. مفيش `PieChart` تاني في الشاشة.
 */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => ({}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

// اليوم المحلي زي الشاشة (todayStr) — toISOString بيدّي يوم UTC، ومن 12 بالليل لـ5 الفجر UTC بتوقيت نيويورك بيبقى بكرة
const today = todayStr();
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

describe('رسم الفترة (بيتغير مع الفترة والفئات)', () => {
  const renderScreen = () => render(<ThemeProvider><PrivacyProvider><ReportsTab /></PrivacyProvider></ThemeProvider>);
  const columns = () => screen.getByTestId('reports_trend').children.length;

  it('تغيير الفترة بيغيّر الأعمدة والعنوان', async () => {
    await renderScreen();
    expect(screen.getByText('مصروفك أسبوع بأسبوع')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('reports_preset_last7'));
    expect(screen.getByText('مصروفك يوم بيوم')).toBeTruthy();
    expect(columns()).toBe(7);

    await fireEvent.press(screen.getByTestId('reports_preset_last6Months'));
    expect(screen.getByText('مصروفك شهر بشهر')).toBeTruthy();
    expect(columns()).toBe(6);
  });

  it('فئة واحدة: العمود بمبلغها بس ومن غير تقسيم ولا مفتاح', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('reports_preset_last7'));
    await fireEvent.press(screen.getAllByText(/مواصلات/)[0]);
    expect(screen.getByText('مصروفك يوم بيوم (الفئات المختارة)')).toBeTruthy();
    expect(screen.queryByTestId('reports_trend_legend', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId(`reports_trend_${today}_c2`, { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('reports_bar_c2')).toBeTruthy();
  });

  it('فئتين: العمود متقسم بيهم، والمفتاح ظاهر', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('reports_preset_last7'));
    await fireEvent.press(screen.getAllByText(/أكل/)[0]);
    await fireEvent.press(screen.getAllByText(/مواصلات/)[0]);
    expect(screen.getByTestId('reports_trend_legend', { includeHiddenElements: true })).toBeTruthy();
    // القارئ بيسمع التقسيم نسب من غير مبالغ
    expect(screen.getByLabelText(/75 بالمية.*25 بالمية$/)).toBeTruthy();
    expect(screen.getByTestId(`reports_trend_${today}_c1`, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId(`reports_trend_${today}_c2`, { includeHiddenElements: true })).toBeTruthy();
  });

  it('السلفة مش في الرسم (نفس spendingExpenses)', async () => {
    Object.assign(mockData, {
      transactions: [{ id: 'loan', type: 'expense', amount: 500, date: today, walletId: 'w' }],
      debts: [{ id: 'd', personName: 'أ', totalAmount: 500, direction: 'owed_to_me', payments: [], initialTransactionId: 'loan', date: today }],
    });
    await renderScreen();
    expect(screen.queryByTestId('reports_trend')).toBeNull();
    expect(screen.getAllByText('مفيش مصاريف في الفترة دي').length).toBeGreaterThan(0);
  });
});
