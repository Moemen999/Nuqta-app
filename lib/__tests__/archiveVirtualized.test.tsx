import React from 'react';
import { render, screen } from '@testing-library/react-native';
import ArchiveScreen from '@/app/archive';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * بند C (مراجعة المشروع 2026-11-05): الأرشيف بـ`FlatList` — "الكل" على آلاف العمليات مبيركّبش كل الصفوف مرة واحدة
 * (كان `ScrollView` + `map`). الهيدر (الإجماليات) والحالة الفاضية لسه ظاهرين.
 */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const today = new Date().toISOString().slice(0, 10);
function seed(n: number) {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [],
    pendingTxIds: new Set(), serverReachable: true, debts: [], gamiyas: [], transfersStatus: 'ready',
    transactions: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, type: 'expense', amount: i + 1, date: today, walletId: 'w', createdAt: `${today}T${String(i % 24).padStart(2, '0')}:00:00Z` })),
  });
}
const ui = () => <ThemeProvider><PrivacyProvider><ArchiveScreen /></PrivacyProvider></ThemeProvider>;

it('500 عملية ← القايمة افتراضية: صفوف قليلة متركّبة مش 500', async () => {
  seed(500);
  await render(ui());
  expect(screen.getByTestId('archive_list')).toBeTruthy();
  const mounted = screen.queryAllByTestId(/^archive_tx_/).length;
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(500);
  // الهيدر لسه موجود
  expect(screen.getByText(/العمليات \(500\)/)).toBeTruthy();
});

it('مفيش عمليات ← الحالة الفاضية', async () => {
  seed(0);
  await render(ui());
  expect(screen.getByText('مفيش عمليات في الفترة دي')).toBeTruthy();
});
