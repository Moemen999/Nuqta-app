import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ChargeHomeCards from '@/components/ChargeHomeCards';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import GamiyaView from '@/components/GamiyaView';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import {
  CHARGE_MISSING_ALERT, CHARGE_UNCERTAIN_ALERT, GAMIYA_ALREADY_RECORDED_ALERT, GAMIYA_BAD_AMOUNT_ALERT, GAMIYA_NOT_SAVED_MESSAGE,
  PAY_OUTCOME_ALERT_GAMIYA, PAY_OUTCOME_ALERT_GAMIYA_PAYOUT,
} from '@/context/DataContext';
import { CHARGE_IN_FLIGHT_DELETE_BLOCK_GAMIYA } from '@/lib/archiving';
import { todayStr } from '@/lib/finance';

/**
 * شاشة الجمعية وكارت الاستلام ونتايج مراجعة الجمعية (2026-11-18): كل نتيجة من `markGamiyaMonthDone` بتتقال برسالتها
 * (كانت `missing`/`already-recorded`/`uncertain` كلها "تم" ساكت أو "ما اتسجلش")، وشهر الاستلام بيتكلم عن استلام مش خصم،
 * والتعديل من غير حساب مبيقفلش الفورم على "تم".
 */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));

const today = todayStr();
const W = { id: 'w1', name: 'الكاش', openingBalance: 0, lowAlert: 0 };
const gam = {
  id: 'g1', name: 'جمعية الشغل', monthlyAmount: 1000, totalMonths: 2, payoutMonthIndex: 2, payoutAmount: 2000,
  walletId: W.id, startDate: '2099-07-01', reminderDaysBefore: 1, createdAt: '2026-07-01',
  months: [
    { id: 'm1', monthIndex: 1, dueDate: '2099-07-01', amount: 1000, status: 'pending', isPayoutMonth: false },
    { id: 'm2', monthIndex: 2, dueDate: '2099-08-01', amount: 2000, status: 'pending', isPayoutMonth: true },
  ],
};

beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [W], categories: [], transactions: [], loadErrors: [], figuresPending: [], subscriptions: [], gamiyas: [gam],
    deleteGamiya: jest.fn(async () => ({ outcome: 'done' })), markGamiyaMonthDone: jest.fn(async () => 'done'),
    updateGamiya: jest.fn(async () => ({ outcome: 'done' })), addGamiya: jest.fn(async () => ({ outcome: 'done' })),
  });
});

const wrap = (node: React.ReactNode) => <ThemeProvider><NoticeProvider><ConfirmProvider><PrivacyProvider>{node}</PrivacyProvider></ConfirmProvider></NoticeProvider></ThemeProvider>;

async function markMonth(label: 'اتخصم' | 'استلمت') {
  await render(wrap(<GamiyaView />));
  await act(async () => { fireEvent.press(screen.getByText('جمعية الشغل')); });
  await act(async () => { fireEvent.press(screen.getByText(label)); });
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
}
const noticeTitle = () => screen.getByTestId('notice_title').props.children;
const noticeBody = () => screen.getByTestId('notice_body').props.children;

describe('"اتخصم" من شاشة الجمعية بالنتايج الجديدة', () => {
  it.each([
    ['uncertain', CHARGE_UNCERTAIN_ALERT],
    ['missing', CHARGE_MISSING_ALERT.gamiya],
    ['already-recorded', GAMIYA_ALREADY_RECORDED_ALERT],
    ['bad-amount', GAMIYA_BAD_AMOUNT_ALERT],
    ['failed', PAY_OUTCOME_ALERT_GAMIYA.failed],
  ])('%s ← رسالتها', async (outcome, alert) => {
    mockData.markGamiyaMonthDone = jest.fn(async () => outcome);
    await markMonth('اتخصم');
    expect(noticeTitle()).toBe(alert.title);
    expect(noticeBody()).toBe(alert.body);
  });
});

describe('شهر الاستلام: الكلام عن استلام مش خصم', () => {
  it.each(['no-connection', 'failed', 'wallet-missing'] as const)('%s', async (outcome) => {
    mockData.markGamiyaMonthDone = jest.fn(async () => outcome);
    await markMonth('استلمت');
    expect(noticeBody()).toBe(PAY_OUTCOME_ALERT_GAMIYA_PAYOUT[outcome].body);
    expect(noticeBody()).not.toContain('خصم');
  });

  it('الكارت في الرئيسية: استلام من غير نت ← رسالة الاستلام', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockData.gamiyas = [{
      ...gam, months: [{ id: 'm1', monthIndex: 1, dueDate: today, amount: 2000, status: 'pending', isPayoutMonth: true }],
    }];
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'no-connection', recorded: [] }));
    mockData.skipSubscriptionCharge = jest.fn();
    await render(<ThemeProvider><PrivacyProvider><ChargeHomeCards /></PrivacyProvider></ThemeProvider>);
    fireEvent.press(screen.getByTestId('charge_card_yes_g1'));
    const payout = PAY_OUTCOME_ALERT_GAMIYA_PAYOUT['no-connection'];
    await waitFor(() => expect(alert).toHaveBeenCalledWith(payout.title, payout.body));
    alert.mockRestore();
  });
});

describe('المسح والتعديل', () => {
  it('المسح اتمنع عشان شهر بيتسجل ← رسالة الحظر', async () => {
    mockData.deleteGamiya = jest.fn(async () => ({ outcome: 'blocked', ...CHARGE_IN_FLIGHT_DELETE_BLOCK_GAMIYA }));
    await render(wrap(<GamiyaView />));
    await act(async () => { fireEvent.press(screen.getByText('جمعية الشغل')); });
    await act(async () => { fireEvent.press(screen.getByText('حذف الجمعية')); });
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
    expect(noticeTitle()).toBe(CHARGE_IN_FLIGHT_DELETE_BLOCK_GAMIYA.title);
  });

  it('التعديل رجع failed (مفيش حساب) ← الرسالة جوه الفورم والمودال مفتوح', async () => {
    mockData.updateGamiya = jest.fn(async () => ({ outcome: 'failed', message: GAMIYA_NOT_SAVED_MESSAGE }));
    await render(wrap(<GamiyaView />));
    await act(async () => { fireEvent.press(screen.getByText('جمعية الشغل')); });
    await act(async () => { fireEvent.press(screen.getByText('تعديل')); });
    await act(async () => { fireEvent.press(screen.getByTestId('gamiya_edit_save')); });
    expect(screen.getByText(GAMIYA_NOT_SAVED_MESSAGE)).toBeTruthy();
    expect(screen.getByTestId('gamiya_edit_save')).toBeTruthy();
  });
});
