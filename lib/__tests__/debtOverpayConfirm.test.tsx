import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { DebtPaymentModal } from '@/components/DebtEntryModals';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import type { Debt } from '@/context/DataContext';

/**
 * نقل التأكيدات — الدفعة 4 (فلوس): تأكيد "المبلغ أكبر من المتبقي" في الدفعة بالمكوّن نفسه.
 * التأكيد Promise: "إلغاء" والقفل ← مفيش دفعة؛ "أيوة، سجّل" ← دفعة بالمبلغ اللي اتكتب.
 */

let mockLocked = false;
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: mockLocked }) }));

const debt = {
  id: 'd1', personName: 'أحمد', direction: 'owed_to_me', totalAmount: 1000, isInstallment: false,
  date: '2026-07-01', createdAt: '2026-07-01', initialWalletId: 'w1',
  payments: [{ id: 'p1', date: '2026-08-01', amount: 400, walletId: 'w1', transactionId: 'tp1' }], increases: [],
} as unknown as Debt;

beforeEach(() => {
  mockLocked = false;
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [], transactions: [],
    addDebtPayment: jest.fn(async () => ({ outcome: 'done', note: null })),
  });
});

const ui = () => <ThemeProvider><NoticeProvider><ConfirmProvider><PrivacyProvider><DebtPaymentModal debt={debt} onClose={jest.fn()} /></PrivacyProvider></ConfirmProvider></NoticeProvider></ThemeProvider>;

async function payTooMuch() {
  const r = await render(ui());
  await act(async () => { fireEvent.changeText(screen.getByTestId('debt_payment_amount'), '700'); });
  await act(async () => { fireEvent.press(screen.getByTestId('debt_payment_save')); });
  return r;
}

it('أكتر من المتبقي ← تأكيد التطبيق قبل أي دفعة', async () => {
  await payTooMuch();
  expect(screen.getByTestId('confirm_title').props.children).toBe('المبلغ أكبر من المتبقي');
  expect(mockData.addDebtPayment).not.toHaveBeenCalled();
});

it('"إلغاء" ← مفيش دفعة', async () => {
  await payTooMuch();
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_cancel')); });
  expect(mockData.addDebtPayment).not.toHaveBeenCalled();
});

it('"أيوة، سجّل" ← دفعة بالمبلغ اللي اتكتب', async () => {
  await payTooMuch();
  await act(async () => { fireEvent.press(screen.getByText('أيوة، سجّل')); });
  expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 700, 'w1', expect.any(String), undefined);
});

// إن الـPromise بيتحل "لأ" مع القفل متثبّت في confirmProvider.test.tsx (H2) — هنا بس إن مفيش دفعة
it('التطبيق اتقفل والتأكيد مفتوح ← التأكيد بيختفي ومفيش دفعة', async () => {
  const r = await payTooMuch();
  mockLocked = true;
  await act(async () => { r.rerender(ui()); });
  expect(screen.queryByTestId('confirm_dialog')).toBeNull();
  expect(mockData.addDebtPayment).not.toHaveBeenCalled();
});

it('دوستين على "حفظ" قبل ما التأكيد يظهر ← تأكيد واحد ودفعة واحدة (money-reviewer)', async () => {
  await render(ui());
  await act(async () => { fireEvent.changeText(screen.getByTestId('debt_payment_amount'), '700'); });
  await act(async () => {
    fireEvent.press(screen.getByTestId('debt_payment_save'));
    fireEvent.press(screen.getByTestId('debt_payment_save'));
  });
  await act(async () => { fireEvent.press(screen.getByText('أيوة، سجّل')); });
  expect(screen.queryByTestId('confirm_dialog')).toBeNull();
  expect(mockData.addDebtPayment).toHaveBeenCalledTimes(1);
});
