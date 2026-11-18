import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import IncomeHomeCards from '@/components/IncomeHomeCards';
import IncomesView from '@/components/IncomesView';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { INCOME_NOT_RECORDED_ALERT, INCOME_RECORD_ALERT } from '@/context/DataContext';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { addMonths, todayStr } from '@/lib/finance';

/**
 * مراجعة الدخل الثابت (2026-11-18، M2/M3/M4): "نزل" من الكارت أو من شاشة الدخل بيقول "اتسجل" **بس** لو
 * `recorded` فيه حاجة — غير كده السبب الحقيقي (اتوقف، اتقفلت "ما نزلش"، اتسجلت قبل كده، الفترة اتغيّرت،
 * المبلغ مش مقروء). والنتايج الجديدة (`missing`، `uncertain`، `amount-changed`) ليها رسايلها.
 * و"نزل" بالمبلغ المعتاد بيبعت `seenAmount` عشان الذرة ترفض لو المعتاد اتغيّر من جهاز تاني.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));
const mockData: Record<string, any> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const today = todayStr();
const income = {
  id: 'i1', name: 'المرتب', amount: 8000, walletId: 'w', frequency: 'monthly', dayOfMonth: 25, mode: 'confirm',
  status: 'active', startDate: addMonths(today, -3), closed: {}, createdAt: '',
};

const wrap = (node: React.ReactNode) => <ThemeProvider><NoticeProvider><ConfirmProvider><PrivacyProvider>{node}</PrivacyProvider></ConfirmProvider></NoticeProvider></ThemeProvider>;
const press = (el: Parameters<typeof fireEvent.press>[0]) => act(async () => { fireEvent.press(el); });

beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    incomes: [income], wallets: [{ id: 'w', name: 'كاش', openingBalance: 0, lowAlert: 0 }], transactions: [],
    recordIncomePeriods: jest.fn(async (_id: string, entries: { key: string }[]) => ({ outcome: 'done', recorded: entries.map(e => e.key) })),
    skipIncomePeriod: jest.fn(), setIncomeStatus: jest.fn(), deleteIncome: jest.fn(async () => 'done'),
  });
});

const reasonCases: [Record<string, unknown>, string][] = [
  [{ outcome: 'done', recorded: [], stopped: true }, INCOME_NOT_RECORDED_ALERT.stopped.title],
  [{ outcome: 'done', recorded: [], skipped: true }, INCOME_NOT_RECORDED_ALERT.skipped.title],
  [{ outcome: 'done', recorded: [], already: true }, INCOME_NOT_RECORDED_ALERT.already.title],
  [{ outcome: 'done', recorded: [], changed: true }, INCOME_NOT_RECORDED_ALERT.changed.title],
  [{ outcome: 'done', recorded: [], badAmount: true }, INCOME_NOT_RECORDED_ALERT.badAmount.title],
  [{ outcome: 'done', recorded: [] }, INCOME_NOT_RECORDED_ALERT.already.title],
  [{ outcome: 'missing', recorded: [] }, INCOME_RECORD_ALERT.missing.title],
  [{ outcome: 'uncertain', recorded: [] }, INCOME_RECORD_ALERT.uncertain.title],
  [{ outcome: 'amount-changed', recorded: [] }, INCOME_RECORD_ALERT['amount-changed'].title],
];

describe('كارت "نزل؟"', () => {
  it.each(reasonCases)('%j ← "%s"', async (result, title) => {
    mockData.recordIncomePeriods = jest.fn(async () => result);
    await render(wrap(<IncomeHomeCards />));
    await press(screen.getByTestId('income_card_yes_i1'));
    await waitFor(() => expect(screen.getByTestId('notice_title').props.children).toBe(title));
  });

  it('"نزل" بالمبلغ المعتاد ← seenAmount بيتبعت', async () => {
    await render(wrap(<IncomeHomeCards />));
    await press(screen.getByTestId('income_card_yes_i1'));
    await waitFor(() => expect(mockData.recordIncomePeriods).toHaveBeenCalled());
    expect(mockData.recordIncomePeriods.mock.calls[0][2]).toEqual({ seenAmount: 8000 });
  });

  it('"المبلغ مختلف" 0.004 ← مرفوض في الشيت (بيتقرّب لصفر)', async () => {
    await render(wrap(<IncomeHomeCards />));
    await press(screen.getByText('المبلغ مختلف'));
    await act(async () => { fireEvent.changeText(screen.getByTestId('income_amount_input'), '0.004'); });
    expect(screen.getByText('المبلغ لازم يكون أكبر من صفر.')).toBeTruthy();
    await press(screen.getByTestId('income_amount_save'));
    expect(mockData.recordIncomePeriods).not.toHaveBeenCalled();
  });

  it('"المبلغ مختلف" 7200.456 ← بيتبعت 7200.46 من غير seenAmount', async () => {
    await render(wrap(<IncomeHomeCards />));
    await press(screen.getByText('المبلغ مختلف'));
    await act(async () => { fireEvent.changeText(screen.getByTestId('income_amount_input'), '7200.456'); });
    await press(screen.getByTestId('income_amount_save'));
    await waitFor(() => expect(mockData.recordIncomePeriods).toHaveBeenCalled());
    const [, entries, opts] = mockData.recordIncomePeriods.mock.calls[0];
    expect(entries[0].amount).toBe(7200.46);
    expect(opts?.seenAmount).toBeUndefined();
  });
});

describe('شاشة الدخل الثابت ← "نزل"', () => {
  it.each(reasonCases)('%j ← "%s"', async (result, title) => {
    mockData.recordIncomePeriods = jest.fn(async () => result);
    await render(wrap(<IncomesView />));
    await press(screen.getByTestId('income_arrived_i1'));
    await press(within(screen.getByTestId('confirm_dialog')).getByText('نزل'));
    await waitFor(() => expect(screen.getByTestId('notice_title').props.children).toBe(title));
  });

  it('بيبعت seenAmount', async () => {
    await render(wrap(<IncomesView />));
    await press(screen.getByTestId('income_arrived_i1'));
    await press(within(screen.getByTestId('confirm_dialog')).getByText('نزل'));
    await waitFor(() => expect(mockData.recordIncomePeriods).toHaveBeenCalled());
    expect(mockData.recordIncomePeriods.mock.calls[0][2]).toEqual({ seenAmount: 8000 });
  });
});
