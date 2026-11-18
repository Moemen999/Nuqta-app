import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ChargeHomeCards, { PAYOUT_INSTALLMENT_LINE } from '@/components/ChargeHomeCards';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import GamiyaView from '@/components/GamiyaView';
import { NoticeProvider } from '@/components/NoticeProvider';
import {
  PAYOUT_INSTALLMENT_INPUT_LABEL, PAYOUT_INSTALLMENT_UNREADABLE_LINE,
} from '@/components/PayoutInstallmentField';
import { ThemeProvider } from '@/context/ThemeContext';
import {
  CHARGE_BAD_INSTALLMENT_ALERT, GAMIYA_BAD_INSTALLMENT_ALERT, GAMIYA_PAYOUT_AMOUNT_CHANGED_ALERT,
} from '@/context/DataContext';
import { gamiyaMonthNote, GAMIYA_NOTE_LEGACY_PAYOUT, GAMIYA_NOTE_PAIR_BROKEN, GAMIYA_NOTE_STRAY_INSTALLMENT } from '@/lib/autoCharge';
import { MONEY_MASK } from '@/lib/money';
import { todayStr } from '@/lib/finance';

/**
 * الجولة 1 على 3a72d99 (money-reviewer + silent-failure-hunter) — شهر استلام الجمعية:
 * 1. القسط الشهري المتخزّن مش مقروء ← طريق حقيقي: المستخدم بيكتب قسطه (الشاشة والكارت)، مش رسالة بتودّي على طريق مقفول.
 * 3. شيت "المبلغ مختلف" بيقول إن قسطك هيتسجل كمان (قاعدة 7)، والمبالغ المخفية مخفية.
 * 4. الكارت بيبعت قسطك اللي عليه (`seenInstallment`) ← اتغيّر = رسالة "الأرقام اتغيّرت".
 * 7. ملاحظة على الشهر لو حسابه ناقص (نسخة قديمة على جهاز تاني) — من غير ما تمنع حاجة.
 */
const mockData: Record<string, unknown> = {};
const privacy = { amountsHidden: false };
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));
jest.mock('@/context/PrivacyContext', () => ({
  usePrivacy: () => ({ amountsHidden: privacy.amountsHidden, money: (n: number) => String(n), toggleAmounts: jest.fn() }),
}));

const today = todayStr();
const W = { id: 'w1', name: 'الكاش', openingBalance: 0, lowAlert: 0 };
type M = { id: string; monthIndex: number; dueDate: string; amount: number; status: 'pending' | 'done'; isPayoutMonth: boolean; transactionId?: string; installmentTransactionId?: string };
const gam = (monthlyAmount: number, months?: M[]) => ({
  id: 'g1', name: 'جمعية الشغل', monthlyAmount, totalMonths: 2, payoutMonthIndex: 2, payoutAmount: 2000,
  walletId: W.id, startDate: '2099-07-01', reminderDaysBefore: 1, createdAt: '2026-07-01',
  months: months ?? [
    { id: 'm1', monthIndex: 1, dueDate: '2099-07-01', amount: 1000, status: 'pending', isPayoutMonth: false },
    { id: 'm2', monthIndex: 2, dueDate: '2099-08-01', amount: 2000, status: 'pending', isPayoutMonth: true },
  ],
});
/** كارت "استلمت؟" النهارده */
const payoutToday = (monthlyAmount: number) => gam(monthlyAmount, [
  { id: 'm1', monthIndex: 1, dueDate: today, amount: 2000, status: 'pending', isPayoutMonth: true },
]);

beforeEach(() => {
  privacy.amountsHidden = false;
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [W], categories: [], transactions: [], loadErrors: [], figuresPending: [], subscriptions: [], gamiyas: [gam(1000)],
    deleteGamiya: jest.fn(async () => ({ outcome: 'done' })), markGamiyaMonthDone: jest.fn(async () => 'done'),
    updateGamiya: jest.fn(async () => ({ outcome: 'done' })), addGamiya: jest.fn(async () => ({ outcome: 'done' })),
    recordCharges: jest.fn(async () => ({ outcome: 'done', recorded: ['m1'] })), skipSubscriptionCharge: jest.fn(),
  });
});

const wrap = (node: React.ReactNode) => <ThemeProvider><NoticeProvider><ConfirmProvider>{node}</ConfirmProvider></NoticeProvider></ThemeProvider>;
const noticeTitle = () => screen.getByTestId('notice_title').props.children;

async function openGamiya() {
  await render(wrap(<GamiyaView />));
  await act(async () => { fireEvent.press(screen.getByText('جمعية الشغل')); });
}

describe('شاشة الجمعية: القسط الشهري مش مقروء', () => {
  it.each([NaN, 0.004])('القسط %p ← "استلمت" بيفتح خانة قسطك (مش تأكيد بيرفض)، والمكتوب بيتبعت', async (bad) => {
    mockData.gamiyas = [gam(bad)];
    await openGamiya();
    await act(async () => { fireEvent.press(screen.getByText('استلمت')); });
    expect(screen.queryByTestId('confirm_action_0')).toBeNull();
    const save = screen.getByTestId('payout_installment_save');
    expect(save).toBeDisabled();
    await act(async () => { fireEvent.changeText(screen.getByLabelText(PAYOUT_INSTALLMENT_INPUT_LABEL), '950'); });
    await act(async () => { fireEvent.press(screen.getByTestId('payout_installment_save')); });
    expect(mockData.markGamiyaMonthDone).toHaveBeenCalledWith('g1', 'm2', 2000, undefined, 950);
  });

  it('المكتوب بيتقرّب لصفر (0.004) ← الزرار مقفول', async () => {
    mockData.gamiyas = [gam(NaN)];
    await openGamiya();
    await act(async () => { fireEvent.press(screen.getByText('استلمت')); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText(PAYOUT_INSTALLMENT_INPUT_LABEL), '0.004'); });
    expect(screen.getByTestId('payout_installment_save')).toBeDisabled();
  });

  it('القسط مقروء ← التأكيد العادي، وbad-installment (اتغيّر في النص) ← رسالة بتسمّي قسطك', async () => {
    mockData.markGamiyaMonthDone = jest.fn(async () => 'bad-installment');
    await openGamiya();
    await act(async () => { fireEvent.press(screen.getByText('استلمت')); });
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
    expect(noticeTitle()).toBe(GAMIYA_BAD_INSTALLMENT_ALERT.title);
    expect(screen.getByTestId('notice_body').props.children).toBe(GAMIYA_BAD_INSTALLMENT_ALERT.body);
  });

  it('شهر الاستلام وamount-changed ← "الأرقام اتغيّرت" (الاستلام أو قسطك)', async () => {
    mockData.markGamiyaMonthDone = jest.fn(async () => 'amount-changed');
    await openGamiya();
    await act(async () => { fireEvent.press(screen.getByText('استلمت')); });
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
    expect(noticeTitle()).toBe(GAMIYA_PAYOUT_AMOUNT_CHANGED_ALERT.title);
  });
});

describe('كارت "استلمت؟"', () => {
  async function renderCard() {
    await render(<ThemeProvider><ChargeHomeCards /></ThemeProvider>);
  }

  it('"استلمت" بيبعت قسطك اللي على الكارت (seenInstallment)', async () => {
    mockData.gamiyas = [payoutToday(1000)];
    await renderCard();
    await act(async () => { fireEvent.press(screen.getByTestId('charge_card_yes_g1')); });
    expect(mockData.recordCharges).toHaveBeenCalledWith('gamiya', 'g1', [{ key: 'm1', amount: 2000, seenInstallment: 1000 }]);
  });

  it('شيت "المبلغ مختلف" بيقول إن قسطك هيتسجل كمان، والمبلغ بالمكتوب بيتبعت مع قسطك اللي اتشاف', async () => {
    mockData.gamiyas = [payoutToday(1000)];
    await renderCard();
    await act(async () => { fireEvent.press(screen.getByLabelText('"جمعية الشغل" المبلغ مختلف')); });
    expect(screen.getByTestId('charge_amount_installment_line')).toHaveTextContent(new RegExp(`${PAYOUT_INSTALLMENT_LINE}.*1,000`));
    await act(async () => { fireEvent.changeText(screen.getByTestId('charge_amount_input'), '1900'); });
    await act(async () => { fireEvent.press(screen.getByTestId('charge_amount_save')); });
    expect(mockData.recordCharges).toHaveBeenCalledWith('gamiya', 'g1', [{ key: 'm1', amount: 1900, seenInstallment: 1000 }]);
  });

  it('المبالغ مخفية ← سطر قسطك في الشيت بالقناع', async () => {
    privacy.amountsHidden = true;
    mockData.gamiyas = [payoutToday(1000)];
    await renderCard();
    await act(async () => { fireEvent.press(screen.getByLabelText('"جمعية الشغل" المبلغ مختلف')); });
    const line = screen.getByTestId('charge_amount_installment_line');
    expect(line).toHaveTextContent(new RegExp(MONEY_MASK));
    expect(line).not.toHaveTextContent(/1,000/);
  });

  it('قسطك مش مقروء ← الكارت بيقول كده، و"استلمت" بيفتح الشيت بخانة قسطك، والمكتوب بيتبعت', async () => {
    mockData.gamiyas = [payoutToday(NaN)];
    await renderCard();
    expect(screen.getByTestId('charge_card_installment_g1')).toHaveTextContent(PAYOUT_INSTALLMENT_UNREADABLE_LINE);
    await act(async () => { fireEvent.press(screen.getByTestId('charge_card_yes_g1')); });
    expect(mockData.recordCharges).not.toHaveBeenCalled();
    expect(screen.getByTestId('charge_amount_save')).toBeDisabled();
    await act(async () => { fireEvent.changeText(screen.getByLabelText(PAYOUT_INSTALLMENT_INPUT_LABEL), '950'); });
    await act(async () => { fireEvent.press(screen.getByTestId('charge_amount_save')); });
    expect(mockData.recordCharges).toHaveBeenCalledWith('gamiya', 'g1', [{ key: 'm1', amount: 2000, installment: 950 }]);
  });

  it.each([
    [{ outcome: 'amount-changed', recorded: [] }, GAMIYA_PAYOUT_AMOUNT_CHANGED_ALERT],
    [{ outcome: 'done', recorded: [], badInstallment: true }, CHARGE_BAD_INSTALLMENT_ALERT],
  ])('%p ← رسالته', async (result, expected) => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockData.gamiyas = [payoutToday(1000)];
    mockData.recordCharges = jest.fn(async () => result);
    await renderCard();
    fireEvent.press(screen.getByTestId('charge_card_yes_g1'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(expected.title, expected.body));
    alert.mockRestore();
  });

  it('مبلغ الاستلام نفسه مش مقروء ← رسالة استلام (مش "خصم")', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockData.gamiyas = [payoutToday(1000)];
    mockData.recordCharges = jest.fn(async () => ({ outcome: 'done', recorded: [], badAmount: true }));
    await renderCard();
    fireEvent.press(screen.getByTestId('charge_card_yes_g1'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(String(alert.mock.calls[0][1])).not.toContain('خصم');
    alert.mockRestore();
  });
});

describe('ملاحظة الشهر لو حسابه ناقص (بند 7)', () => {
  const payout = (over: Partial<M>): M => ({ id: 'm2', monthIndex: 2, dueDate: '2099-08-01', amount: 2000, status: 'done', isPayoutMonth: true, ...over });
  const ids = (...x: string[]) => new Set(x);

  it('الدالة', () => {
    // سليم
    expect(gamiyaMonthNote(payout({ transactionId: 'p', installmentTransactionId: 'i' }), ids('p', 'i'))).toBeNull();
    // واحدة من الاتنين اتمسحت
    expect(gamiyaMonthNote(payout({ transactionId: 'p', installmentTransactionId: 'i' }), ids('p'))).toBe(GAMIYA_NOTE_PAIR_BROKEN);
    expect(gamiyaMonthNote(payout({ transactionId: 'p', installmentTransactionId: 'i' }), ids('i'))).toBe(GAMIYA_NOTE_PAIR_BROKEN);
    // قديم: الاستلام بس
    expect(gamiyaMonthNote(payout({ transactionId: 'p' }), ids('p'))).toBe(GAMIYA_NOTE_LEGACY_PAYOUT);
    // pending وقسطك لسه موجود
    expect(gamiyaMonthNote(payout({ status: 'pending', installmentTransactionId: 'i' }), ids('i'))).toBe(GAMIYA_NOTE_STRAY_INSTALLMENT);
    // pending والعلامة لوحدها (العملية مش موجودة) — مفيش فلوس اتحركت
    expect(gamiyaMonthNote(payout({ status: 'pending', installmentTransactionId: 'i' }), ids())).toBeNull();
    // قسط عادي
    expect(gamiyaMonthNote({ ...payout({ transactionId: 'p' }), isPayoutMonth: false }, ids('p'))).toBeNull();
  });

  it('بتبان تحت الشهر في الشاشة، ومش بتقفل حاجة', async () => {
    mockData.gamiyas = [gam(1000, [
      { id: 'm1', monthIndex: 1, dueDate: '2099-07-01', amount: 1000, status: 'pending', isPayoutMonth: false },
      payout({ transactionId: 'p' }),
    ])];
    mockData.transactions = [{ id: 'p', type: 'income', amount: 2000, walletId: 'w1', date: '2099-08-01' }];
    await openGamiya();
    expect(screen.getByTestId('gamiya_month_note_m2')).toHaveTextContent(GAMIYA_NOTE_LEGACY_PAYOUT);
    expect(screen.queryByTestId('gamiya_month_note_m1')).toBeNull();
    expect(screen.getByText('اتدفع')).toBeTruthy();
  });

  it('العمليات لسه بتحمّل ← مفيش ملاحظة (مش حكم على بيانات ما وصلتش)', async () => {
    mockData.figuresPending = ['transactions'];
    mockData.gamiyas = [gam(1000, [
      { id: 'm1', monthIndex: 1, dueDate: '2099-07-01', amount: 1000, status: 'pending', isPayoutMonth: false },
      payout({ transactionId: 'p', installmentTransactionId: 'i' }),
    ])];
    await openGamiya();
    expect(screen.queryByTestId('gamiya_month_note_m2')).toBeNull();
  });
});
