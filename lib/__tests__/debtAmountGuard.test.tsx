import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AddDebtModal, DebtIncreaseModal, DebtPaymentModal } from '@/components/DebtEntryModals';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import type { Debt } from '@/context/DataContext';
import { isValidDebtAmount } from '@/lib/finance';

/**
 * مبلغ مش محدود (زي "1e999" = Infinity) مبيتسجلش في أي مودال دين.
 *
 * `!amt || amt <= 0` في الدفعة والدين الجديد كان بيعدّي Infinity فيتكتب في
 * الدين ورصيد المحفظة؛ الزيادة بس كان فيها `isFinite`. الفحص بقى دالة واحدة
 * (`isValidDebtAmount`) والتلات مودالات بينادوها.
 */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/components/useDeviceContacts', () => ({
  useDeviceContacts: () => ({ contacts: [], visible: false, open: jest.fn(), close: jest.fn(), createContact: jest.fn() }),
}));

const debt = {
  id: 'd1', direction: 'owed_to_me', personName: 'صاحبي', totalAmount: 6000, isInstallment: false,
  date: '2026-01-01', payments: [], increases: [],
} as unknown as Debt;

// غير المحدود (الثغرة) + الصفر والسالب (كانوا مرفوضين قبل كده وفاضلين مرفوضين)
const INVALID = ['1e999', '-1e999', 'Infinity', 'NaN', 'abc', '0', '-5'];

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [], transactions: [],
    addDebtPayment: jest.fn(async () => ({ outcome: 'done', note: null })),
    addDebtIncrease: jest.fn(async () => ({ outcome: 'done', note: null })),
    addDebt: jest.fn(async () => {}),
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

const wrap = (ui: React.ReactElement) => <ThemeProvider><NoticeProvider><PrivacyProvider>{ui}</PrivacyProvider></NoticeProvider></ThemeProvider>;

describe('isValidDebtAmount', () => {
  it('رقم موجب محدود ← ماشي', () => {
    expect(isValidDebtAmount(100)).toBe(true);
    expect(isValidDebtAmount(0.01)).toBe(true);
    expect(isValidDebtAmount(Number.MAX_VALUE)).toBe(true);
  });
  it('صفر، سالب، Infinity، NaN ← مرفوض', () => {
    for (const v of [0, -0, -5, Infinity, -Infinity, NaN, Number('1e999')]) {
      expect(isValidDebtAmount(v)).toBe(false);
    }
  });
});

describe('دفعة الدين', () => {
  async function pay(amount: string) {
    const onClose = jest.fn();
    await render(wrap(<DebtPaymentModal debt={debt} onClose={onClose} />));
    await act(async () => { fireEvent.changeText(screen.getByTestId('debt_payment_amount'), amount); });
    await act(async () => { fireEvent.press(screen.getByTestId('debt_payment_save')); });
    return onClose;
  }

  it.each(INVALID)('%s ← مرفوض بنفس الرسالة، ومفيش دفعة ولا تأكيد', async v => {
    const onClose = await pay(v);
    expect(screen.getByText('دخّل مبلغ ومحفظة صحيحين')).toBeTruthy();
    expect(mockData.addDebtPayment).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('أصغر مبلغ (0.01) ← بيتسجل', async () => {
    await pay('0.01');
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 0.01, 'w1', expect.any(String), undefined);
  });

  it('مبلغ عادي ← بيتسجل والمودال بيتقفل', async () => {
    const onClose = await pay('100');
    expect(mockData.addDebtPayment).toHaveBeenCalledWith('d1', 100, 'w1', expect.any(String), undefined);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('دين جديد', () => {
  async function add(amount: string) {
    const onClose = jest.fn();
    await render(wrap(<AddDebtModal onClose={onClose} />));
    await act(async () => { fireEvent.changeText(screen.getByTestId('debt_add_person'), 'صاحبي'); });
    await act(async () => { fireEvent.changeText(screen.getByTestId('debt_add_amount'), amount); });
    await act(async () => { fireEvent.press(screen.getByTestId('debt_add_save')); });
    return onClose;
  }

  it.each(INVALID)('%s ← مرفوض بنفس الرسالة، ومفيش دين', async v => {
    const onClose = await add(v);
    expect(screen.getByText('من فضلك دخّل اسم ومبلغ صحيحين')).toBeTruthy();
    expect(mockData.addDebt).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('مبلغ عادي ← بيتسجل والمودال بيتقفل', async () => {
    const onClose = await add('500');
    expect(mockData.addDebt).toHaveBeenCalledWith(expect.objectContaining({ personName: 'صاحبي', totalAmount: 500, walletId: 'w1' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('زيادة الدين', () => {
  async function increase(amount: string) {
    const onClose = jest.fn();
    await render(wrap(<DebtIncreaseModal debt={debt} onClose={onClose} />));
    await act(async () => { fireEvent.changeText(screen.getByTestId('debt_increase_amount'), amount); });
    await act(async () => { fireEvent.press(screen.getByTestId('debt_increase_save')); });
    return onClose;
  }

  it.each(INVALID)('%s ← مرفوض زي الأول، ومفيش زيادة', async v => {
    const onClose = await increase(v);
    expect(screen.getByText('دخّل مبلغ صحيح')).toBeTruthy();
    expect(mockData.addDebtIncrease).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('مبلغ عادي ← بيتسجل والمودال بيتقفل', async () => {
    const onClose = await increase('250');
    expect(mockData.addDebtIncrease).toHaveBeenCalledWith('d1', 250, expect.any(String), 'w1');
    expect(onClose).toHaveBeenCalled();
  });
});
