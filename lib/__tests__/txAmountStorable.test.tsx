import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import AddTransactionModal from '@/app/modal';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { warmUp } from '@/test-utils/warmUp';

/**
 * R1 (2026-10-28): الحارس كان بيفحص الرقم قبل التقريب، فـ"1e307" (محدود) كان
 * بيعدّي، و`roundMoney` بيحوّله Infinity ويتكتب على العملية والدين. الفحص بقى
 * على المبلغ بعد التقريب (`storableAmount`) — في المودال وفي الدالة.
 *
 * المسارين: عملية مربوطة بدين (الذرة) وعملية عادية (`updateTransaction`)، لأن
 * الحارس سطر واحد مشترك في `handleSave`.
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
const debt = {
  id: 'd1', personName: 'صاحبي', direction: 'owed_to_me', isInstallment: false, totalAmount: 100000,
  date: '2026-03-10', createdAt: 'x', increases: [],
  payments: [{ id: 'p1', date: '2026-03-20', amount: 100, walletId: 'w1', transactionId: 'tx_p' }],
};

function seed() {
  Object.assign(mockData, {
    wallets: [wallet], categories: [], transactions: [payTx, freeTx],
    debts: [debt], subscriptions: [], gamiyas: [], incomes: [],
    linkSourcesReady: true, loadErrors: [], retryLoad: jest.fn(),
    addTransaction: jest.fn(), updateTransaction: jest.fn(), deleteTransaction: jest.fn(), transactionLinkWarning: () => null,
    updateDebtLinkedTransaction: jest.fn(async () => ({ outcome: 'done', note: null })),
  });
}

beforeEach(() => { mockParams = {}; seed(); (router.back as jest.Mock).mockClear(); });

const ui = () => <ThemeProvider><PrivacyProvider><AddTransactionModal /></PrivacyProvider></ThemeProvider>;
warmUp(() => { seed(); return ui(); });

async function saveWith(id: string, typed: string) {
  mockParams = { id };
  await render(ui());
  await act(async () => {});
  await act(async () => { fireEvent.changeText(screen.getByTestId('tx_amount_input'), typed); });
  await act(async () => { fireEvent.press(screen.getByTestId('tx_save_button')); });
}

describe.each(['1e307', '1e308', 'Infinity'])('مبلغ "%s"', typed => {
  it('عملية دين ← مرفوض: مفيش كتابة، والمودال مفتوح برسالة', async () => {
    await saveWith('tx_p', typed);
    expect(mockData.updateDebtLinkedTransaction).not.toHaveBeenCalled();
    expect(mockData.updateTransaction).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByText('من فضلك دخّل مبلغ صحيح ومحفظة')).toBeTruthy();
  });

  it('عملية عادية ← مرفوض بنفس الشكل', async () => {
    await saveWith('tx_f', typed);
    expect(mockData.updateTransaction).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    expect(screen.getByText('من فضلك دخّل مبلغ صحيح ومحفظة')).toBeTruthy();
  });
});

describe.each([['0.01', 0.01], ['100', 100], ['250.5', 250.5]])('مبلغ عادي "%s"', (typed, value) => {
  it('عملية دين ← بيتحفظ', async () => {
    await saveWith('tx_p', typed);
    expect(mockData.updateDebtLinkedTransaction).toHaveBeenCalledWith(
      'tx_p', expect.objectContaining({ amount: value }), expect.anything(), []);
  });

  it('عملية عادية ← بيتحفظ', async () => {
    await saveWith('tx_f', typed);
    expect(mockData.updateTransaction).toHaveBeenCalledWith('tx_f', expect.objectContaining({ amount: value }), []);
  });
});
