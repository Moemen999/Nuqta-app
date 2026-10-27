import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AddTransactionModal from '@/app/modal';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { warmUp } from '@/test-utils/warmUp';

/**
 * المودال على عملية مربوطة (بند 14، 2026-10-27):
 * - مربوطة بدين ← الحفظ بيروح للذرة اللي بتعدّل الدين معاها، مش `updateTransaction`
 * - أي ربط ← النوع مقفول
 * - تسوية ← بتبان من غير فورم، مفيش حفظ ولا حذف
 * - مش مربوطة ← زي ما هي (`updateTransaction`)
 */

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const wallet = { id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 };
const payTx = { id: 'tx_p', type: 'income', amount: 100, walletId: 'w1', date: '2026-03-20' };
const freeTx = { id: 'tx_f', type: 'expense', amount: 50, walletId: 'w1', date: '2026-03-20' };
const settleTx = { id: 'tx_s', type: 'withdraw', amount: 30, walletId: 'w1', toWalletId: 'w2', date: '2026-03-20', isSettlement: true };
const debt = {
  id: 'd1', personName: 'صاحبي', direction: 'owed_to_me', isInstallment: false, totalAmount: 1000,
  date: '2026-03-10', createdAt: 'x', increases: [],
  payments: [{ id: 'p1', date: '2026-03-20', amount: 100, walletId: 'w1', transactionId: 'tx_p' }],
};

function seed() {
  Object.assign(mockData, {
    wallets: [wallet], categories: [], transactions: [payTx, freeTx, settleTx],
    debts: [debt], subscriptions: [], gamiyas: [], incomes: [], linkSourcesReady: true, loadErrors: [], retryLoad: jest.fn(),
    addTransaction: jest.fn(), updateTransaction: jest.fn(), deleteTransaction: jest.fn(), transactionLinkWarning: () => null,
    updateDebtLinkedTransaction: jest.fn(async () => ({ outcome: 'done', note: null })),
  });
}

beforeEach(() => { mockParams = {}; seed(); });

const ui = () => <ThemeProvider><PrivacyProvider><AddTransactionModal /></PrivacyProvider></ThemeProvider>;
warmUp(() => { seed(); return ui(); });

it('دفعة دين ← الحفظ بيعدّل الدين معاها في الذرة', async () => {
  mockParams = { id: 'tx_p' };
  await render(ui());
  await act(async () => {});
  await act(async () => { fireEvent.changeText(screen.getByTestId('tx_amount_input'), '120'); });
  await act(async () => { fireEvent.press(screen.getByTestId('tx_save_button')); });
  expect(mockData.updateDebtLinkedTransaction).toHaveBeenCalledWith(
    'tx_p', expect.objectContaining({ amount: 120, walletId: 'w1', date: '2026-03-20' }),
    { amount: 100, walletId: 'w1', type: 'income' }, []);
  expect(mockData.updateTransaction).not.toHaveBeenCalled();
});

it('عملية مربوطة ← النوع مقفول وفيه سطر بيقول ليه', async () => {
  mockParams = { id: 'tx_p' };
  await render(ui());
  await act(async () => {});
  expect(screen.getByTestId('tx_type_locked')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tx_type_expense'));
  await act(async () => { fireEvent.changeText(screen.getByTestId('tx_amount_input'), '120'); });
  await act(async () => { fireEvent.press(screen.getByTestId('tx_save_button')); });
  expect(mockData.updateDebtLinkedTransaction).toHaveBeenCalledWith('tx_p', expect.objectContaining({ type: 'income' }), expect.anything(), []);
});

it('تسوية ← من غير فورم ولا حفظ', async () => {
  mockParams = { id: 'tx_s' };
  await render(ui());
  await act(async () => {});
  expect(screen.getByTestId('tx_settlement_locked')).toBeTruthy();
  expect(screen.queryByTestId('tx_save_button')).toBeNull();
});

it('عملية مش مربوطة ← زي ما هي: updateTransaction والنوع مفتوح', async () => {
  mockParams = { id: 'tx_f' };
  await render(ui());
  await act(async () => {});
  expect(screen.queryByTestId('tx_type_locked')).toBeNull();
  await act(async () => { fireEvent.changeText(screen.getByTestId('tx_amount_input'), '60'); });
  await act(async () => { fireEvent.press(screen.getByTestId('tx_save_button')); });
  expect(mockData.updateTransaction).toHaveBeenCalled();
  expect(mockData.updateDebtLinkedTransaction).not.toHaveBeenCalled();
});

it('البيانات لسه ما وصلتش ← شاشة استنى، مش فورم بيحفظ في المسار الغلط', async () => {
  mockParams = { id: 'tx_p' };
  mockData.linkSourcesReady = false;
  await render(ui());
  await act(async () => {});
  expect(screen.getByTestId('tx_waiting')).toBeTruthy();
  expect(screen.queryByTestId('tx_save_button')).toBeNull();
  // ومش "اتمسحت" — هي لسه ما وصلتش
  expect(screen.queryByTestId('tx_missing')).toBeNull();
});

it('الربط بالدين اتفك والفورم مفتوح ← الفورم بيتقفل ومفيش حفظ', async () => {
  mockParams = { id: 'tx_p' };
  const r = await render(ui());
  await act(async () => {});
  expect(screen.getByTestId('tx_type_locked')).toBeTruthy();
  mockData.debts = [];
  await act(async () => { await r.rerender(ui()); });
  expect(screen.getByTestId('tx_link_changed')).toBeTruthy();
  expect(screen.queryByTestId('tx_save_button')).toBeNull();
  expect(mockData.updateTransaction).not.toHaveBeenCalled();
});

it('قراية اترفضت ← "جرّب تاني" بيعيد الـlisteners، مش "اتأكد من النت"', async () => {
  mockParams = { id: 'tx_p' };
  mockData.linkSourcesReady = false;
  mockData.loadErrors = ['incomes'];
  await render(ui());
  await act(async () => {});
  await act(async () => { fireEvent.press(screen.getByTestId('tx_waiting_retry')); });
  expect(mockData.retryLoad).toHaveBeenCalled();
});
