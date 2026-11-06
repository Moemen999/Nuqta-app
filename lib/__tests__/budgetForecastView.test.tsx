import React from 'react';
import { render, screen } from '@testing-library/react-native';
import BudgetView from '@/components/BudgetView';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/** سطر "لو كمّلت بنفس المعدل" تحت الفئة وتحت الإجمالي في الميزانية (قرارات مؤمن 2026-11-05) */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

// الساعة بس اللي متثبّتة (اليوم) — المؤقتات حقيقية عشان الـrender
function freeze(iso: string) {
  jest.useFakeTimers({ now: new Date(`${iso}T09:00:00`), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
}
afterEach(() => jest.useRealTimers());

function setup(day: string, extraTx: unknown[] = []) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    categories: [{ id: 'c1', name: 'خروجات' }],
    budgets: { c1: 1000, total_budget: 5000 },
    transactions: [
      { id: 't1', type: 'expense', amount: 250, date: day, walletId: 'w', categoryId: 'c1' },
      { id: 't1b', type: 'expense', amount: 150, date: day, walletId: 'w', categoryId: 'c1' },
      { id: 't1c', type: 'expense', amount: 100, date: day, walletId: 'w', categoryId: 'c1' },
      ...extraTx,
    ],
    debts: [], gamiyas: [], setBudget: jest.fn(),
  });
}

const ui = () => <ThemeProvider><PrivacyProvider><BudgetView /></PrivacyProvider></ThemeProvider>;

it('يوم 10: 500 من 1000 ← "هتخلص يوم 20 نوفمبر" تحت الفئة، والإجمالي (500 من 5000) مفيهوش', async () => {
  freeze('2026-11-10');
  setup('2026-11-03');
  await render(ui());
  expect(screen.getAllByTestId(/^budget_forecast_/)).toHaveLength(1);
  expect(screen.getByTestId('budget_forecast_c1')).toBeTruthy();
  expect(screen.getByText('لو كمّلت بنفس المعدل، الميزانية هتخلص يوم 20 نوفمبر')).toBeTruthy();
});

it('عملية بتاريخ قدام جوه الشهر مبتنفخش المعدل بس بتتخصم من الفاضل', async () => {
  freeze('2026-11-10');
  // 500 لحد النهارده + 200 يوم 28: المعدل من الـ500 بس (50/يوم — لو دخلت كانت 70)، والـ200 محجوزة من الفاضل (300) ← 10 + 6 = يوم 16
  setup('2026-11-03', [{ id: 't2', type: 'expense', amount: 200, date: '2026-11-28', walletId: 'w', categoryId: 'c1' }]);
  await render(ui());
  expect(screen.getByText('لو كمّلت بنفس المعدل، الميزانية هتخلص يوم 16 نوفمبر')).toBeTruthy();
});

it('عملية واحدة (500) مفيهاش سطر — 3 عالأقل (قرار مؤمن)', async () => {
  freeze('2026-11-10');
  setup('2026-11-03');
  Object.assign(mockData, { transactions: [{ id: 'one', type: 'expense', amount: 500, date: '2026-11-03', walletId: 'w', categoryId: 'c1' }] });
  await render(ui());
  expect(screen.queryAllByTestId(/^budget_forecast_/)).toHaveLength(0);
});

it('أول 7 أيام مفيش سطر', async () => {
  freeze('2026-11-05');
  setup('2026-11-03');
  await render(ui());
  expect(screen.queryAllByTestId(/^budget_forecast_/)).toHaveLength(0);
});

it('السلفة مبتتعدّش في المعدل (نفس monthSpend بالتحويلات)', async () => {
  freeze('2026-11-10');
  setup('2026-11-03');
  Object.assign(mockData, {
    debts: [{ id: 'd', personName: 'أ', totalAmount: 250, direction: 'owed_to_me', payments: [], initialTransactionId: 't1', date: '2026-11-03' }],
  });
  await render(ui());
  expect(screen.queryAllByTestId(/^budget_forecast_/)).toHaveLength(0);
});

it('دراسة الشكل خطوة 4: رقم بطل (اتصرف من الإجمالي)، والفئة من غير سقف مطوية', async () => {
  freeze('2026-11-10');
  setup('2026-11-03');
  mockData.categories = [{ id: 'c1', name: 'خروجات' }, { id: 'c2', name: 'هدايا' }];
  await render(ui());
  expect(screen.getByTestId('budget_hero')).toBeTruthy();
  // "هدايا" مالهاش سقف ← جوه القسم المطوي، مش ظاهرة لحد ما يتفتح
  expect(screen.queryByText(/هدايا/)).toBeNull();
  expect(screen.getByTestId('budget_no_limit_toggle')).toBeTruthy();
});

it('الكارت اللي اتكتب فيه في المطوي بيفضل فيه بعد الحفظ (كان بيتنقل والكيبورد بيقع)', async () => {
  const { act, fireEvent } = require('@testing-library/react-native');
  freeze('2026-11-10');
  setup('2026-11-03');
  mockData.categories = [{ id: 'c1', name: 'خروجات' }, { id: 'c2', name: 'هدايا' }];
  const r = await render(ui());
  await act(async () => { fireEvent.press(screen.getByTestId('budget_no_limit_toggle')); });
  await act(async () => { fireEvent(screen.getByLabelText('سقف 🏷️ هدايا'), 'focus'); });
  // الحفظ التلقائي وصل: السقف بقى متخزّن
  mockData.budgets = { c1: 1000, c2: 300, total_budget: 5000 };
  await r.rerender(ui());
  expect(screen.getByTestId('budget_no_limit_toggle').props.accessibilityLabel).toBe('فئات من غير سقف، فئة واحدة');
  expect(screen.getByLabelText('سقف 🏷️ هدايا')).toBeTruthy();
});
