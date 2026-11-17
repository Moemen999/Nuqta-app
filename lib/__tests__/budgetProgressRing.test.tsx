import React from 'react';
import { processColor } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import BudgetView from '@/components/BudgetView';
import { ringFraction } from '@/components/ProgressRing';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { progressRing } from '@/lib/tokens';

/** دايرة تقدّم الميزانية الإجمالية: نفس أرقام الكارت، ومن غير ميزانية مفيش دايرة */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/lib/useReduceMotion', () => ({ useReduceMotion: () => true, useReduceMotionKnown: () => true }));

const CIRC = 2 * Math.PI * ((progressRing.size - progressRing.stroke) / 2);

function setupDate() { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`; }
function setup(total: number, spent: number) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  const today = new Date();
  const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  Object.assign(mockData, {
    wallets: [], categories: [{ id: 'c1', name: 'خروجات' }],
    budgets: total ? { total_budget: total } : {},
    transactions: [{ id: 't1', type: 'expense', amount: spent, date: d, walletId: 'w', categoryId: 'c1' }],
    debts: [], gamiyas: [], setBudget: jest.fn(),
  });
}
let themeColors: ReturnType<typeof useTheme>['colors'];
function Probe() { themeColors = useTheme().colors; return null; }
const ui = () => <ThemeProvider><PrivacyProvider><Probe /><BudgetView /></PrivacyProvider></ThemeProvider>;
const fill = () => screen.getByTestId('budget_ring_fill', { includeHiddenElements: true });
const offset = () => Number(fill().props.strokeDashoffset?.__getValue?.() ?? fill().props.strokeDashoffset);

it('ringFraction: محصورة 0..1 وصفر/غير صالح ← 0', () => {
  expect(ringFraction(250, 1000)).toBe(0.25);
  expect(ringFraction(5000, 1000)).toBe(1);
  expect(ringFraction(-5, 1000)).toBe(0);
  expect(ringFraction(5, 0)).toBe(0);
  expect(ringFraction(Infinity, 100)).toBe(0);
});

it('1000 من 4000 ← الدايرة 25%', async () => {
  setup(4000, 1000);
  await render(ui());
  await waitFor(() => expect(offset()).toBeCloseTo(CIRC * 0.75, 3));
  expect(screen.getByTestId('budget_hero')).toBeTruthy();
  expect(fill().props.stroke.payload).toBe(processColor(themeColors.accentText));
});

it('مفيش ميزانية إجمالية ← مفيش دايرة', async () => {
  setup(0, 1000);
  await render(ui());
  expect(screen.queryByTestId('budget_ring')).toBeNull();
});

it('فوق 100% (6000 من 4000) ← الدايرة مليانة بلون الخطر زي الرقم البطل', async () => {
  setup(4000, 6000);
  await render(ui());
  await waitFor(() => expect(offset()).toBeCloseTo(0, 3));
  expect(fill().props.stroke.payload).toBe(processColor(themeColors.dangerText));
});

it('الدايرة مخفية عن القارئ (الأرقام جنبها بتتقري)', async () => {
  setup(4000, 1000);
  await render(ui());
  expect(screen.getByTestId('budget_ring', { includeHiddenElements: true }).props.importantForAccessibility).toBe('no-hide-descendants');
});

it('96% ← الشرطة أقصر من المحيط (الدايرة مش مقفولة) والطرف butt', async () => {
  setup(10000, 9600);
  await render(ui());
  await waitFor(() => expect(offset()).toBeCloseTo(CIRC * 0.04, 3));
  expect(offset()).toBeGreaterThan(0);
  expect(fill().props.strokeLinecap).toBe(0) // 0 = butt (1 = round);
});

it('0.1+0.2 من 0.3 ← درجة at: دهبي مش خطر (نفس budgetLevel، مش مقارنة خام)', async () => {
  setup(0.3, 0.1);
  mockData.transactions = [
    { id: 'a', type: 'expense', amount: 0.1, date: setupDate(), walletId: 'w', categoryId: 'c1' },
    { id: 'b', type: 'expense', amount: 0.2, date: setupDate(), walletId: 'w', categoryId: 'c1' },
  ];
  await render(ui());
  await waitFor(() => expect(fill().props.stroke.payload).toBe(processColor(themeColors.accentText)));
  expect(screen.getByTestId('budget_ring', { includeHiddenElements: true })).toBeTruthy();
});

const flat = (n: unknown): Record<string, unknown> => Object.assign({}, ...[(n as { props: { style?: unknown } }).props.style].flat(5).filter(Boolean));

it.each([1000, 999.996])('at (%s من 1000): الدايرة والفئة دهبي مش خطر', async (spent) => {
  setup(1000, spent);
  mockData.budgets = { total_budget: 1000, c1: 1000 };
  await render(ui());
  await waitFor(() => expect(fill().props.stroke.payload).toBe(processColor(themeColors.accentText)));
  expect(flat(screen.getByText(/خلصت — /)).color).toBe(themeColors.accentText);
});

it('over (1000.01 من 1000): الدايرة والفئة خطر', async () => {
  setup(1000, 1000.01);
  mockData.budgets = { total_budget: 1000, c1: 1000 };
  await render(ui());
  await waitFor(() => expect(fill().props.stroke.payload).toBe(processColor(themeColors.dangerText)));
  expect(flat(screen.getByText(/عدّيت — /)).color).toBe(themeColors.dangerText);
});

it('صفر مصروف ← مفيش شرطة ملوّنة', async () => {
  setup(4000, 0);
  await render(ui());
  expect(screen.getByTestId('budget_ring', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByTestId('budget_ring_fill', { includeHiddenElements: true })).toBeNull();
});
