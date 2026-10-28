import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import GamiyaView from '@/components/GamiyaView';
import { NoticeProvider } from '@/components/NoticeProvider';
import SubscriptionsView from '@/components/SubscriptionsView';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ENTRY_MESSAGES, LEGACY_VALUE_NOTE } from '@/lib/entryValidation';

/**
 * C2 (2026-10-28): قيمة متخزّنة من نسخة قديمة وبقت برّه الحدود (تذكير 400 يوم). الحفظ لسه
 * بيترفض لحد ما تتصلح (قرار مؤمن: الغلط بيترفض برسالة، مبيتغيّرش ساكت) — بس الرسالة بتبان
 * **أول ما التعديل يتفتح**، مش بعد "احفظ".
 */
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
const done = async () => ({ outcome: 'done' });
const sub = { id: 's1', name: 'نتفليكس', amount: 200, walletId: 'w1', frequency: 'monthly', nextDueDate: '2099-01-01',
  reminderDaysBefore: 400, active: true, history: [], closed: {}, createdAt: 'x' };
const gam = { id: 'g1', name: 'جمعية الشغل', monthlyAmount: 1000, totalMonths: 2, payoutMonthIndex: 2, payoutAmount: 2000,
  walletId: 'w1', startDate: '2099-01-01', reminderDaysBefore: 400, createdAt: 'x',
  months: [{ id: 'm1', monthIndex: 1, dueDate: '2099-01-01', amount: 1000, status: 'pending', isPayoutMonth: false }] };

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [], transactions: [],
    subscriptions: [sub], gamiyas: [gam], loadErrors: [], figuresPending: [],
    updateSubscription: jest.fn(done), updateGamiya: jest.fn(done), addSubscription: jest.fn(done), addGamiya: jest.fn(done),
    deleteSubscription: jest.fn(), deleteGamiya: jest.fn(), markSubscriptionPaid: jest.fn(), markGamiyaMonthDone: jest.fn(),
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());
const wrap = (ui: React.ReactElement) => <ThemeProvider><NoticeProvider><PrivacyProvider>{ui}</PrivacyProvider></NoticeProvider></ThemeProvider>;
const press = async (el: unknown) => { await act(async () => { fireEvent.press(el as never); }); };
const type = async (el: unknown, v: string) => { await act(async () => { fireEvent.changeText(el as never, v); }); };
const expected = `${LEGACY_VALUE_NOTE} ${ENTRY_MESSAGES.reminderDays}`;

it('اشتراك: الرسالة باينة أول ما التعديل يتفتح، والحفظ مرفوض لحد ما الخانة تتصلح', async () => {
  await render(wrap(<SubscriptionsView />));
  await press(screen.getByText('تعديل'));
  expect(screen.getByText(expected)).toBeTruthy();
  await press(screen.getByTestId('subscription_edit_save'));
  expect(mockData.updateSubscription).not.toHaveBeenCalled();
  await type(screen.getByDisplayValue('400'), '3');
  await press(screen.getByTestId('subscription_edit_save'));
  expect(mockData.updateSubscription).toHaveBeenCalledWith('s1', expect.objectContaining({ reminderDaysBefore: 3 }));
});

it('جمعية: نفس الكلام', async () => {
  await render(wrap(<GamiyaView />));
  await press(screen.getByText('جمعية الشغل'));
  await press(screen.getByText('تعديل'));
  expect(screen.getByText(expected)).toBeTruthy();
});

it('قيم سليمة ← مفيش رسالة', async () => {
  mockData.subscriptions = [{ ...sub, reminderDaysBefore: 3 }];
  await render(wrap(<SubscriptionsView />));
  await press(screen.getByText('تعديل'));
  expect(screen.queryByText(new RegExp(LEGACY_VALUE_NOTE))).toBeNull();
});
