import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import ChargeHomeCards from '@/components/ChargeHomeCards';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { ThemeProvider } from '@/context/ThemeContext';
import { PAY_OUTCOME_ALERT } from '@/context/DataContext';
import { todayStr } from '@/lib/finance';

/**
 * نقل التأكيدات — الدفعة 3 بالمكوّن نفسه: "ما اتخصمش" على كارت الاشتراك. التأكيد قبل أي كتابة،
 * "رجوع" مبيكتبش، والتأكيد بيكتب بالمفتاح الصح، والفشل بيبان.
 */

const today = todayStr();
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));
jest.mock('@/context/PrivacyContext', () => ({
  usePrivacy: () => ({ amountsHidden: false, money: (n: number) => String(n), toggleAmounts: jest.fn() }),
}));

beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }], transactions: [], categories: [],
    subscriptions: [{
      id: 's1', name: 'نتفليكس', amount: 200, walletId: 'w1', frequency: 'monthly', nextDueDate: today,
      reminderDaysBefore: 3, active: true, history: [], createdAt: '2026-01-01',
    }],
    gamiyas: [],
    recordCharges: jest.fn(async () => ({ outcome: 'done', recorded: [today] })),
    skipSubscriptionCharge: jest.fn(async () => 'done'),
  });
});

const ui = () => <ThemeProvider><NoticeProvider><ConfirmProvider><ChargeHomeCards /></ConfirmProvider></NoticeProvider></ThemeProvider>;

async function openSkip() {
  await render(ui());
  await act(async () => { fireEvent.press(screen.getByLabelText('"نتفليكس" ما اتخصمش')); });
}

it('"ما اتخصمش" ← تأكيد التطبيق قبل أي كتابة، و"رجوع" مبيكتبش', async () => {
  await openSkip();
  expect(screen.getByTestId('confirm_title').props.children).toContain('نتفليكس');
  expect(mockData.skipSubscriptionCharge).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_cancel')); });
  expect(mockData.skipSubscriptionCharge).not.toHaveBeenCalled();
});

it('التأكيد ← skipSubscriptionCharge بالمفتاح الصح', async () => {
  await openSkip();
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  expect(mockData.skipSubscriptionCharge).toHaveBeenCalledWith('s1', today);
});

it('من غير نت ← رسالة "ما اتغيّرش حاجة" بتبان بعد التأكيد', async () => {
  mockData.skipSubscriptionCharge = jest.fn(async () => 'no-connection');
  await openSkip();
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  expect(screen.getByTestId('notice_title').props.children).toBe(PAY_OUTCOME_ALERT['no-connection'].title);
});
