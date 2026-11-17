import React from 'react';
import { processColor } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';
import BudgetView from '@/components/BudgetView';
import MonthSummaryCard from '@/components/MonthSummaryCard';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { budgetLevel } from '@/lib/budgetForecast';
import { buildAttentionItems, type AttentionInput } from '@/lib/homeAttention';
import { snapPiastre } from '@/lib/finance';

/** نفس الأرقام ← نفس الكلمة ونفس اللون في الأربع أماكن: كارت الشهر، بانر الفئة، كارت الفئة، الإجمالي + الدايرة */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/lib/useReduceMotion', () => ({ useReduceMotion: () => true, useReduceMotionKnown: () => true }));

const today = new Date();
const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
let colors: ReturnType<typeof useTheme>['colors'];
function Probe() { colors = useTheme().colors; return null; }
const flat = (n: unknown): Record<string, unknown> => Object.assign({}, ...[(n as { props: { style?: unknown } }).props.style].flat(5).filter(Boolean));
const wrap = (c: React.ReactNode) => <ThemeProvider><PrivacyProvider><Probe />{c}</PrivacyProvider></ThemeProvider>;

// الدرجة ← [كلمة كارت الشهر، كلمة بانر الفئة، كلمة كارت الفئة، كلمة الإجمالي، لون]
const CASES: [number, 'at' | 'over', RegExp, RegExp, RegExp, 'accentText' | 'dangerText'][] = [
  [999.996, 'at', /^الميزانية خلصت$/, / خلصت \(/, /^خلصت — /, 'accentText'],
  [1000, 'at', /^الميزانية خلصت$/, / خلصت \(/, /^خلصت — /, 'accentText'],
  [1000.01, 'over', /^عدّيت الميزانية بـ /, / عدّيت \(/, /^عدّيت — /, 'dangerText'],
];

describe.each(CASES)('%s من 1000 (%s)', (spent, level, homeWord, bannerWord, catWord, colorKey) => {
  it('الأربع أماكن: نفس الدرجة والكلمة واللون', async () => {
    expect(budgetLevel(spent, 1000)).toBe(level);
    await render(wrap(<MonthSummaryCard testID="m" onPress={() => {}} state={{ kind: 'ready', transfersFailed: false, budgetsFailed: false,
      summary: { spent, previous: null, budget: { limit: 1000, remaining: snapPiastre(1000 - spent), level } } as never }} />));
    const line = screen.getByTestId('home_month_budget_line');
    expect(String(line.props.children).replace(/,/g, '')).toMatch(homeWord);
    expect(flat(line).color).toBe(colors[colorKey]);
    // دايرة الرئيسية: نفس لون كلمة الكارت
    expect(screen.getByTestId('home_month_ring_fill', { includeHiddenElements: true }).props.stroke.payload).toBe(processColor(colors[colorKey]));
    if (level === 'over') expect([line.props.children].flat().join('')).toBe('عدّيت الميزانية بـ 0.01 ج.م');

    const [item] = buildAttentionItems({
      spendKnown: true, nowMonth: d.slice(0, 7), transfers: new Set(), money: (n: number) => String(n),
      activeCategories: [{ id: 'c1', name: 'أكل' }], budgets: { c1: 1000 }, activeWallets: [], balances: new Map(), subscriptions: [], gamiyas: [],
      transactions: [{ id: 'a', type: 'expense', amount: spent, date: d, walletId: 'w', categoryId: 'c1' }],
    } as unknown as AttentionInput);
    expect(item.text).toMatch(bannerWord);
    expect(item.tone).toBe(level === 'over' ? 'danger' : 'warn');

    for (const k of Object.keys(mockData)) delete mockData[k];
    Object.assign(mockData, {
      wallets: [], categories: [{ id: 'c1', name: 'خروجات' }], budgets: { total_budget: 1000, c1: 1000 },
      transactions: [{ id: 't1', type: 'expense', amount: spent, date: d, walletId: 'w', categoryId: 'c1' }],
      debts: [], gamiyas: [], setBudget: jest.fn(),
    });
    await render(wrap(<BudgetView />));
    await waitFor(() => expect(screen.getByTestId('budget_ring_fill', { includeHiddenElements: true }).props.stroke.payload).toBe(processColor(colors[colorKey])));
    expect(flat(screen.getByText(catWord)).color).toBe(colors[colorKey]);
    const total = screen.getByTestId('budget_total_level');
    expect(String(total.props.children).replace(/,/g, '')).toMatch(homeWord);
    expect(flat(total).color).toBe(colors[colorKey]);
    if (level === 'over') expect([total.props.children].flat().join('')).toBe('عدّيت الميزانية بـ 0.01 ج.م');
  });
});
