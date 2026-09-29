import { readFileSync } from 'fs';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import ArchiveScreen from '@/app/archive';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { TRANSFERS_NOTE } from '@/lib/spending';

/**
 * خطوة 8 على الشاشات: السلفة والجمعية برّه المصروف والدخل.
 * - الأرشيف: الإجماليات من غيرهم، وسطر بيقول كده لما يبقى فيه منهم في الفترة
 * - الرئيسية والميزانية: إجمالي الشهر من الدالة المختبَرة `monthSpendTotal`
 *   (كان reduce مكتوب مرتين جوه الشاشات، والاختبارات مكانتش تقدر تمسك غلطه)
 * - التقارير: المصروفات من `spendingExpenses` (الفترة والفترة اللي قبلها)
 */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const today = new Date().toISOString().slice(0, 10);
const tx = (id: string, type: string, amount: number) => ({ id, type, amount, date: today, walletId: 'w' });

beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [],
    pendingTxIds: new Set(), serverReachable: true, debts: [], gamiyas: [],
  });
});

async function renderArchive() {
  await render(<ThemeProvider><PrivacyProvider><ArchiveScreen /></PrivacyProvider></ThemeProvider>);
}

it('الأرشيف: فيه سلفة في الفترة ← السطر بيظهر', async () => {
  mockData.transactions = [tx('t_lend', 'expense', 2000), tx('food', 'expense', 150)];
  mockData.debts = [{ direction: 'owed_to_me', initialTransactionId: 't_lend', payments: [], increases: [] }];
  await renderArchive();
  expect(screen.getByTestId('archive_transfers_note').props.children).toBe(TRANSFERS_NOTE);
});

it('الأرشيف: مفيش سلفة ولا جمعية ← مفيش سطر', async () => {
  mockData.transactions = [tx('food', 'expense', 150)];
  await renderArchive();
  expect(screen.queryByTestId('archive_transfers_note')).toBeNull();
});

describe('الشاشات بتستخدم الدوال المختبَرة', () => {
  const src = (f: string) => readFileSync(f, 'utf8');

  it.each(['app/(tabs)/index.tsx', 'components/BudgetView.tsx'])('%s: إجمالي الشهر ومصروف الفئة من غير التحويلات', (f) => {
    const s = src(f);
    expect(s).toMatch(/const transfers = useMemo\(\(\) => transferTransactionIds\(debts, gamiyas\), \[debts, gamiyas\]\)/);
    expect(s).toContain('monthSpendTotal(transactions, nowMonth, transfers)');
    expect(s).toMatch(/monthSpend\(transactions, c\.id, nowMonth, transfers\)/);
    expect(s).not.toMatch(/t\.type === 'expense' && t\.date\.slice\(0, 7\) === nowMonth\)\s*\.reduce/);
    expect(s).not.toMatch(/filter\(t => t\.type === 'expense' && t\.date\.slice\(0, 7\) === nowMonth\)\.reduce/);
  });

  it('التقارير: الفترة والفترة اللي قبلها من spendingExpenses', () => {
    const s = src('app/(tabs)/reports.tsx');
    expect((s.match(/spendingExpenses\(/g) || []).length).toBe(2);
    expect(s).not.toMatch(/filter\(t => t\.type === 'expense'/);
  });

  it('الشخبطة: مصروف كل قسم من spendingExpenses', () => {
    expect(src('components/ShakhbataView.tsx')).toContain('spendingExpenses(transactions, transfers)');
  });

  it('الأرشيف: الإجماليات من cashTotals', () => {
    expect(src('app/archive.tsx')).toContain('cashTotals(filtered, transfers)');
  });
});
