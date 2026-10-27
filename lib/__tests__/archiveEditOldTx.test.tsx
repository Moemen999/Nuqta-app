import { readFileSync } from 'fs';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import ArchiveScreen from '@/app/archive';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * بند 14: العملية اللي نزلت تحت أحدث 10 كانت مالهاش تعديل ولا مسح — الرئيسية
 * بتعرض 10 بس، والأرشيف كان عرض بس. دلوقتي صف الأرشيف بيفتح نفس مودال
 * الرئيسية بنفس المعرّف، والمودال بيدوّر في كل العمليات مش في الـ10.
 */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const src = (p: string) => readFileSync(`${__dirname}/../../${p}`, 'utf8');

const today = new Date().toISOString().slice(0, 10);
// 12 عملية: "old_0" هي الأقدم، يعني تحت أحدث 10 في الرئيسية
const txs = Array.from({ length: 12 }, (_, i) => ({
  id: `old_${i}`, type: 'expense', amount: 10 + i, date: today, walletId: 'w',
  createdAt: `${today}T10:${String(i).padStart(2, '0')}:00.000Z`,
}));

beforeEach(() => {
  (router.push as jest.Mock).mockClear();
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    transactions: txs,
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [],
    pendingTxIds: new Set(), serverReachable: true, debts: [], gamiyas: [],
  });
});

async function renderArchive() {
  await render(<ThemeProvider><PrivacyProvider><ArchiveScreen /></PrivacyProvider></ThemeProvider>);
}

it('عملية أقدم من أحدث 10 ← الدوسة بتفتح مودال العملية بمعرّفها', async () => {
  await renderArchive();
  fireEvent.press(screen.getByTestId('archive_tx_old_0'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/modal', params: { id: 'old_0' } });
});

it('كل صف في الأرشيف قابل للدوس — مش بس اللي في الرئيسية', async () => {
  await renderArchive();
  for (const t of txs) expect(screen.getByTestId(`archive_tx_${t.id}`)).toBeTruthy();
});

it('المودال بيدوّر في كل العمليات، مش في أحدث 10', () => {
  // لو حد قصّ القايمة جوه المودال، الدوسة من الأرشيف هتفتح فورم "إضافة" فاضي
  // بدل العملية — فالسطر ده هو اللي بيخلي الدوسة تعني تعديل فعلاً
  expect(src('app/modal.tsx')).toContain('transactions.find(t => t.id === id)');
});
