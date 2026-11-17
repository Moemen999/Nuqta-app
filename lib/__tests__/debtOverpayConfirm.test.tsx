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
/** المودال بيقرا الدين حي من `useData().debts` بالمعرّف (بند 7) ← الدين بيتحط هناك قبل الرسم */
const withDebt = (d: { id: string }) => { mockData.debts = [...((mockData.debts as { id: string }[] | undefined) ?? []).filter(x => x.id !== d.id), d]; return d.id; };
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

const ui = () => <ThemeProvider><NoticeProvider><ConfirmProvider><PrivacyProvider><DebtPaymentModal debtId={withDebt(debt)} onClose={jest.fn()} /></PrivacyProvider></ConfirmProvider></NoticeProvider></ThemeProvider>;

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

describe('بند 7: المودال بيقرا الدين حي', () => {
  const live = (d: Debt, onClose: () => void) =>
    <ThemeProvider><NoticeProvider><ConfirmProvider><PrivacyProvider><DebtPaymentModal debtId={d.id} onClose={onClose} /></PrivacyProvider></ConfirmProvider></NoticeProvider></ThemeProvider>;

  it('دفعة نزلت من جهاز تاني والمودال مفتوح ← فحص "أكبر من المتبقي" على المتبقي الجديد', async () => {
    mockData.debts = [debt];
    const r = await render(live(debt, jest.fn()));
    // المتبقي كان 600؛ دفعة 400 من جهاز تاني ← 200. الـ500 بقت أكبر من المتبقي
    mockData.debts = [{ ...debt, payments: [...debt.payments, { id: 'p2', date: '2026-08-02', amount: 400, walletId: 'w1', transactionId: 'tp2' }] }];
    await act(async () => { r.rerender(live(debt, jest.fn())); });
    await act(async () => { fireEvent.changeText(screen.getByTestId('debt_payment_amount'), '500'); });
    await act(async () => { fireEvent.press(screen.getByTestId('debt_payment_save')); });
    expect(screen.getByTestId('confirm_title').props.children).toBe('المبلغ أكبر من المتبقي');
    expect(mockData.addDebtPayment).not.toHaveBeenCalled();
  });

  it('الدين اتمسح والمودال مفتوح ← بيتقفل برسالة', async () => {
    const onClose = jest.fn();
    mockData.debts = [debt];
    const r = await render(live(debt, onClose));
    mockData.debts = [];
    await act(async () => { r.rerender(live(debt, onClose)); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('الدين اتمسح')).toBeTruthy();
    expect(screen.queryByTestId('debt_payment_save')).toBeNull();
  });

  it('النتيجة "uncertain" ← الرسالة والمودال بيتقفل (منعيدش من غير ما نبص)', async () => {
    const onClose = jest.fn();
    mockData.debts = [debt];
    mockData.addDebtPayment = jest.fn(async () => ({ outcome: 'uncertain' }));
    await render(live(debt, onClose));
    await act(async () => { fireEvent.changeText(screen.getByTestId('debt_payment_amount'), '100'); });
    await act(async () => { fireEvent.press(screen.getByTestId('debt_payment_save')); });
    expect(screen.getByText('مش متأكدين اتسجلت ولا لأ')).toBeTruthy();
    expect(onClose).toHaveBeenCalled();
  });
});
