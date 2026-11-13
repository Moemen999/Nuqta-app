import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { NoticeProvider } from '@/components/NoticeProvider';

/** قرار مؤمن 2026-11-06: علامة «تحويل — مش محسوب» على عمليات السلفة/الجمعية في الأرشيف */

const mockData: Record<string, unknown> = {
  wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [],
};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const wrap = (ui: React.ReactElement) => <ThemeProvider><NoticeProvider><PrivacyProvider>{ui}</PrivacyProvider></NoticeProvider></ThemeProvider>;

it('الأرشيف: عملية سلفة عليها العلامة، وبتظهر لما الديون توصل بعد العمليات (الصف memo)', async () => {
  const ArchiveScreen = require('@/app/archive').default;
  const today = new Date().toISOString().slice(0, 10);
  Object.assign(mockData, {
    brokenTransactions: [], pendingTxIds: new Set(), serverReachable: true, gamiyas: [], transfersStatus: 'ready', debts: [],
    transactions: [
      { id: 'loan', type: 'expense', amount: 100, date: today, walletId: 'w1' },
      { id: 'food', type: 'expense', amount: 50, date: today, walletId: 'w1' },
    ],
  });
  const ui = () => wrap(<ArchiveScreen />);
  const r = await render(ui());
  expect(screen.queryAllByLabelText('تحويل، مش محسوب في الدخل ولا المصروف')).toHaveLength(0);
  mockData.debts = [{ id: 'd', direction: 'owed_to_me', personName: 'س', totalAmount: 100, date: today, initialTransactionId: 'loan', payments: [], increases: [] }];
  await r.rerender(ui());
  expect(screen.getAllByLabelText('تحويل، مش محسوب في الدخل ولا المصروف')).toHaveLength(1);
});

