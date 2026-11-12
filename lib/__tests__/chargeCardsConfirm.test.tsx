import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import ChargeHomeCards, { SUB_RECORDS_TODAY_HINT } from '@/components/ChargeHomeCards';
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

// تلميح "هيتسجل بتاريخ النهاردة": بس لاشتراك فترته من شهر غير الشهر ده. "النهاردة" من todayStr() زي باقي الملف
const firstOfPrevMonth = () => {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
};

it('اشتراك فترته في شهر فات ← تلميح "هيتسجل بتاريخ النهاردة" ظاهر', async () => {
  (mockData.subscriptions as { nextDueDate: string }[])[0].nextDueDate = firstOfPrevMonth();
  await render(ui());
  expect(screen.getByText(SUB_RECORDS_TODAY_HINT)).toBeTruthy();
});

it('اشتراك فترته في الشهر ده ← مفيش تلميح', async () => {
  await render(ui());
  expect(screen.getByText(/معاده/)).toBeTruthy();
  expect(screen.queryByText(SUB_RECORDS_TODAY_HINT)).toBeNull();
});

it('شهر جمعية في شهر فات ← مفيش تلميح (الجمعية بتتسجل بمعادها)', async () => {
  mockData.subscriptions = [];
  mockData.gamiyas = [{
    id: 'g1', name: 'جمعية العيلة', monthlyAmount: 500, totalMonths: 6, payoutMonthIndex: 6, payoutAmount: 3000,
    walletId: 'w1', startDate: firstOfPrevMonth(), reminderDaysBefore: 3, createdAt: '2026-01-01',
    months: [{ id: 'm1', monthIndex: 1, dueDate: firstOfPrevMonth(), isPayoutMonth: false, amount: 500, status: 'pending' }],
  }];
  await render(ui());
  expect(screen.getByTestId('charge_card_g1')).toBeTruthy();
  expect(screen.queryByText(SUB_RECORDS_TODAY_HINT)).toBeNull();
});
