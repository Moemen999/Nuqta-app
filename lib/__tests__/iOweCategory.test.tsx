import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AddTransactionModal from '@/app/modal';
import { DebtPaymentModal } from '@/components/DebtEntryModals';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import type { Debt } from '@/context/DataContext';

/**
 * "عليك له" (قرارات مؤمن 2026-11-05): الاستلاف من محفظة وسداده تحويل ← مفيش شريحة فئة (كانت هتتحفظ ومتتعدّش).
 * الشرا بالأجل (دين "عليك له" من غير محفظة) سداده مصروف ← الشريحة موجودة والفئة بتتبعت.
 */

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/components/useDeviceContacts', () => ({
  useDeviceContacts: () => ({ contacts: [], visible: false, open: jest.fn(), close: jest.fn(), createContact: jest.fn() }),
}));
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const base = {
  id: 'd1', direction: 'i_owe', personName: 'المحل', totalAmount: 1000, isInstallment: false,
  date: '2026-01-01', createdAt: 'x', increases: [],
  payments: [{ id: 'p1', date: '2026-02-01', amount: 200, walletId: 'w1', transactionId: 'tx_p', categoryId: 'c1' }],
};
const borrowed = { ...base, initialTransactionId: 'tx_init', initialWalletId: 'w1' } as unknown as Debt;
const credit = base as unknown as Debt;

beforeEach(() => {
  mockParams = {};
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }],
    categories: [{ id: 'c1', name: 'أكل' }],
    transactions: [{ id: 'tx_p', type: 'expense', amount: 200, walletId: 'w1', date: '2026-02-01', categoryId: 'c1' }],
    subscriptions: [], gamiyas: [], incomes: [], linkSourcesReady: true, loadErrors: [], retryLoad: jest.fn(),
    addTransaction: jest.fn(), updateTransaction: jest.fn(), deleteTransaction: jest.fn(), transactionLinkWarning: () => null,
    updateDebtLinkedTransaction: jest.fn(async () => ({ outcome: 'done', note: null })),
    addDebtPayment: jest.fn(async () => ({ outcome: 'done', note: null })),
  });
});

const wrap = (ui: React.ReactElement) => <ThemeProvider><NoticeProvider><PrivacyProvider>{ui}</PrivacyProvider></NoticeProvider></ThemeProvider>;

describe('مودال دفعة الدين', () => {
  it('استلاف من محفظة ← مفيش "الفئة"، والدفعة من غير فئة', async () => {
    mockData.debts = [borrowed];
    await render(wrap(<DebtPaymentModal debt={borrowed} onClose={jest.fn()} />));
    expect(screen.queryByText('الفئة (اختياري)')).toBeNull();
    await act(async () => { fireEvent.changeText(screen.getByTestId('debt_payment_amount'), '100'); });
    await act(async () => { fireEvent.press(screen.getByTestId('debt_payment_save')); });
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 100, 'w1', expect.any(String), undefined);
  });

  it('شرا بالأجل ← "الفئة" موجودة والفئة المختارة بتتبعت', async () => {
    mockData.debts = [credit];
    await render(wrap(<DebtPaymentModal debt={credit} onClose={jest.fn()} />));
    expect(screen.getByText('الفئة (اختياري)')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText(/أكل/)); });
    await act(async () => { fireEvent.changeText(screen.getByTestId('debt_payment_amount'), '100'); });
    await act(async () => { fireEvent.press(screen.getByTestId('debt_payment_save')); });
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 100, 'w1', expect.any(String), 'c1');
  });
});

describe('مودال تعديل العملية', () => {
  it('سداد استلاف (تحويل) ← مفيش شريحة "الفئة"', async () => {
    mockData.debts = [borrowed];
    mockParams = { id: 'tx_p' };
    await render(wrap(<AddTransactionModal />));
    expect(screen.queryByText('الفئة')).toBeNull();
  });

  it('سداد شرا بالأجل (مصروف) ← شريحة "الفئة" موجودة', async () => {
    mockData.debts = [credit];
    mockParams = { id: 'tx_p' };
    await render(wrap(<AddTransactionModal />));
    expect(screen.getByText('الفئة')).toBeTruthy();
  });
});
