import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import GamiyaView from '@/components/GamiyaView';
import { NoticeProvider } from '@/components/NoticeProvider';
import SubscriptionsView from '@/components/SubscriptionsView';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { CUSTOM_DAYS_MAX, ENTRY_MESSAGES, REMINDER_DAYS_MAX } from '@/lib/entryValidation';

/**
 * D-A (2026-10-28): "كل كام يوم" بين 1 و1096 (3 سنين — أوسع حد عند خدمة دفع كبيرة)،
 * والتذكير بين 0 و365. قبل الحد كان 1e8 يوم بيعدّي وتاريخه بيبوظ، و2,914,000 يوم
 * بيطلّع سنة من 5 أرقام فالاشتراك يبان مستحق على طول.
 */

const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const sub = {
  id: 's1', name: 'نتفليكس', amount: 200, walletId: 'w1', frequency: 'custom', customDays: 30, nextDueDate: '2099-01-01',
  reminderDaysBefore: 3, active: true, history: [], closed: {}, createdAt: 'x',
};
const done = async () => ({ outcome: 'done' });
let alertSpy: jest.SpyInstance;
beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [{ id: 'w1', name: 'كاش', openingBalance: 0, lowAlert: 0 }], categories: [], transactions: [],
    subscriptions: [sub], gamiyas: [], loadErrors: [], figuresPending: [],
    addSubscription: jest.fn(done), updateSubscription: jest.fn(done), addGamiya: jest.fn(done), updateGamiya: jest.fn(done),
    deleteSubscription: jest.fn(), deleteGamiya: jest.fn(), markSubscriptionPaid: jest.fn(), markGamiyaMonthDone: jest.fn(),
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

const wrap = (ui: React.ReactElement) => <ThemeProvider><NoticeProvider><PrivacyProvider>{ui}</PrivacyProvider></NoticeProvider></ThemeProvider>;
const type = async (el: unknown, v: string) => { await act(async () => { fireEvent.changeText(el as never, v); }); };
const press = async (el: unknown) => { await act(async () => { fireEvent.press(el as never); }); };

it('الحدود نفسها', () => {
  expect(CUSTOM_DAYS_MAX).toBe(1096);
  expect(REMINDER_DAYS_MAX).toBe(365);
});

describe('اشتراك جديد', () => {
  async function add(o: { custom?: string; reminder?: string }) {
    await render(wrap(<SubscriptionsView />));
    await press(screen.getByTestId('subscription_add_button'));
    await type(screen.getByPlaceholderText('مثلاً: نتفليكس'), 'شاهد');
    await type(screen.getByPlaceholderText('0'), '150');
    if (o.custom !== undefined) { await press(screen.getAllByText('مخصص').at(-1)); await type(screen.getByDisplayValue('30'), o.custom); }
    if (o.reminder !== undefined) await type(screen.getByDisplayValue('3'), o.reminder);
    await press(screen.getByTestId('subscription_add_save'));
  }
  it.each(['1097', '100000000', '2914000'])('"كل كام يوم" %s ← مرفوض', async v => {
    await add({ custom: v });
    expect(mockData.addSubscription).not.toHaveBeenCalled();
    expect(screen.getByText(ENTRY_MESSAGES.customDays)).toBeTruthy();
  });
  it('"كل كام يوم" 1096 ← بيتحفظ', async () => {
    await add({ custom: '1096' });
    expect(mockData.addSubscription).toHaveBeenCalledWith(expect.objectContaining({ customDays: 1096 }));
  });
  it('تذكير 366 ← مرفوض؛ 365 ← بيتحفظ', async () => {
    await add({ reminder: '366' });
    expect(mockData.addSubscription).not.toHaveBeenCalled();
    expect(screen.getByText(ENTRY_MESSAGES.reminderDays)).toBeTruthy();
    await type(screen.getByDisplayValue('366'), '365');
    await press(screen.getByTestId('subscription_add_save'));
    expect(mockData.addSubscription).toHaveBeenCalledWith(expect.objectContaining({ reminderDaysBefore: 365 }));
  });
});

describe('تعديل اشتراك', () => {
  it('"كل كام يوم" 1097 ← مرفوض؛ 1096 ← بيتحفظ', async () => {
    await render(wrap(<SubscriptionsView />));
    await press(screen.getByText('تعديل'));
    await type(screen.getByDisplayValue('30'), '1097');
    await press(screen.getByTestId('subscription_edit_save'));
    expect(mockData.updateSubscription).not.toHaveBeenCalled();
    expect(screen.getByText(ENTRY_MESSAGES.customDays)).toBeTruthy();
    await type(screen.getByDisplayValue('1097'), '1096');
    await press(screen.getByTestId('subscription_edit_save'));
    expect(mockData.updateSubscription).toHaveBeenCalledWith('s1', expect.objectContaining({ customDays: 1096 }));
  });
});

it('جمعية جديدة: تذكير 366 ← مرفوض', async () => {
  await render(wrap(<GamiyaView />));
  await press(screen.getByTestId('gamiya_add_button'));
  await type(screen.getByPlaceholderText('مثلاً: جمعية الشغل'), 'جمعية');
  await type(screen.getByPlaceholderText('0'), '1000');
  await type(screen.getByDisplayValue('3'), '366');
  await type(screen.getByPlaceholderText('عادة = القسط × عدد الأعضاء'), '12000');
  await press(screen.getByTestId('gamiya_add_save'));
  expect(mockData.addGamiya).not.toHaveBeenCalled();
  expect(screen.getByText(ENTRY_MESSAGES.reminderDays)).toBeTruthy();
});
