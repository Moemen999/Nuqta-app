import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AddTransactionModal from '@/app/modal';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { warmUp } from '@/test-utils/warmUp';

/**
 * R2 على المودال نفسه (2026-10-28): التغيير اللي بيروح للتسوية والمبلغ اللي
 * بيروح للحفظ لازم يبقوا نفس الرقم المقرّب. اختبار المحاكي بيبني التسوية بإيده
 * من `storedEditChange`، فمكانش هيلاحظ لو المودال رجع يبعت `amt` الخام
 * (silent-failure-hunter). هنا بنمسك اللي المودال بيبعته فعلاً للشيت.
 */

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
// الشيت نفسها ليها اختباراتها — هنا بنسجّل التغيير اللي وصلها ونكمّل بتسوية واحدة
const mockRequest = jest.fn((_changes: unknown, run: (s: unknown[]) => void) => run([{ fake: true }]));
jest.mock('@/components/ArchivedSettlement', () => ({
  useArchivedSettlement: () => ({ request: mockRequest, sheet: null }),
}));

const payTx = { id: 'tx_p', type: 'income', amount: 100, walletId: 'a', date: '2026-03-20' };
const debt = {
  id: 'd1', personName: 'صاحبي', direction: 'owed_to_me', isInstallment: false, totalAmount: 1000,
  date: '2026-03-10', createdAt: 'x', increases: [],
  payments: [{ id: 'p1', date: '2026-03-20', amount: 100, walletId: 'a', transactionId: 'tx_p' }],
};

function seed() {
  Object.assign(mockData, {
    wallets: [{ id: 'a', name: 'مؤرشفة', openingBalance: 0, lowAlert: 0, archived: true }, { id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }],
    categories: [], transactions: [payTx], debts: [debt], subscriptions: [], gamiyas: [], incomes: [],
    linkSourcesReady: true, loadErrors: [], retryLoad: jest.fn(),
    addTransaction: jest.fn(), updateTransaction: jest.fn(), deleteTransaction: jest.fn(), transactionLinkWarning: () => null,
    updateDebtLinkedTransaction: jest.fn(async () => ({ outcome: 'done', note: null })),
  });
}

beforeEach(() => { mockParams = { id: 'tx_p' }; seed(); mockRequest.mockClear(); });

const ui = () => <ThemeProvider><PrivacyProvider><AddTransactionModal /></PrivacyProvider></ThemeProvider>;
warmUp(() => { seed(); return ui(); });

it('1.005 على دفعة دين ← التسوية والحفظ الاتنين بـ1 (المتخزّن)، مش 1.005', async () => {
  await render(ui());
  await act(async () => {});
  await act(async () => { fireEvent.changeText(screen.getByTestId('tx_amount_input'), '1.005'); });
  await act(async () => { fireEvent.press(screen.getByTestId('tx_save_button')); });

  const changes = mockRequest.mock.calls[0][0] as { after: { amount: number } }[];
  expect(changes[0].after.amount).toBe(1);
  expect(mockData.updateDebtLinkedTransaction).toHaveBeenCalledWith(
    'tx_p', expect.objectContaining({ amount: 1 }), expect.anything(), [{ fake: true }]);
});
