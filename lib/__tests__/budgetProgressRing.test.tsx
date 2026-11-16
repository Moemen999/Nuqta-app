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
jest.mock('@/lib/useReduceMotion', () => ({ useReduceMotion: () => true }));

const CIRC = 2 * Math.PI * ((progressRing.size - progressRing.stroke) / 2);

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
