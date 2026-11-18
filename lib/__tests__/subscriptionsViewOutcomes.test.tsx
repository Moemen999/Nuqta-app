import { IOS_DISMISS_FALLBACK_MS } from '@/components/ActionSheet';
import React from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import SubscriptionsView from '@/components/SubscriptionsView';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { CHARGE_MISSING_ALERT, CHARGE_UNCERTAIN_ALERT, type Subscription } from '@/context/DataContext';
import { addDays, todayStr } from '@/lib/finance';

/**
 * شاشة الاشتراكات ونتايج مراجعة 2026-11-17: "اتخصم" بنتيجة `uncertain`/`missing`، والتعديل بيبعت المعاد بس لو اتغيّر
 * (بند D) وبيحذّر لو المعاد اتقدّم بعد مرات متأخرة لسه ما اتسجلتش، والمسح بيعدّ كل عمليات الاشتراك (بند H).
 */
const today = todayStr();
const mockData: Record<string, unknown> = {};
let mockPickDate = today;
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/components/CalendarPickerModal', () => ({
  __esModule: true,
  default: ({ visible, onSelect }: { visible: boolean; onSelect: (d: string) => void }) => {
    const { Pressable: P, Text: T } = require('react-native');
    return visible ? <P testID="pick_date" onPress={() => onSelect(mockPickDate)}><T>pick</T></P> : null;
  },
}));
void Pressable; void Text;

const W = { id: 'w1', name: 'الكاش', openingBalance: 0, lowAlert: 0 };
const sub = (over: Partial<Subscription> = {}) => ({
  id: 's1', name: 'نتفليكس', amount: 200, walletId: W.id, frequency: 'monthly', nextDueDate: today,
  reminderDaysBefore: 3, active: true, history: [], createdAt: '2026-01-01', ...over,
}) as unknown as Subscription;

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  mockPickDate = today;
  Object.assign(mockData, {
    wallets: [W], categories: [], transactions: [], loadErrors: [], figuresPending: [],
    subscriptions: [sub()],
    deleteSubscription: jest.fn(async () => ({ outcome: 'done' })), markSubscriptionPaid: jest.fn(async () => 'done'),
    setSubscriptionActive: jest.fn(async () => 'done'), updateSubscription: jest.fn(async () => ({ outcome: 'done' })),
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { alertSpy.mockRestore(); });

const wrap = () => <ThemeProvider><NoticeProvider><PrivacyProvider><SubscriptionsView /></PrivacyProvider></NoticeProvider></ThemeProvider>;
async function pressAlertButton(text: string) {
  const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as { text: string; onPress?: () => unknown }[];
  await act(async () => { await buttons.find(b => b.text === text)?.onPress?.(); });
}
async function openMenuItem(testID: string) {
  await act(async () => { fireEvent.press(screen.getByTestId('subscription_more_s1')); });
  await act(async () => { fireEvent.press(screen.getByTestId(testID)); });
  await act(async () => { await new Promise(r => setTimeout(r, IOS_DISMISS_FALLBACK_MS + 50)); });
}

describe('"اتخصم" بالنتايج الجديدة', () => {
  it('uncertain ← "مش متأكدين" (مش "ما اتسجلش")', async () => {
    mockData.markSubscriptionPaid = jest.fn(async () => 'uncertain');
    await render(wrap());
    await act(async () => { fireEvent.press(screen.getByText('اتخصم')); });
    await pressAlertButton('تأكيد');
    expect(screen.getByTestId('notice_title').props.children).toBe(CHARGE_UNCERTAIN_ALERT.title);
  });
  it('missing ← "الاشتراك ده اتمسح"', async () => {
    mockData.markSubscriptionPaid = jest.fn(async () => 'missing');
    await render(wrap());
    await act(async () => { fireEvent.press(screen.getByText('اتخصم')); });
    await pressAlertButton('تأكيد');
    expect(screen.getByTestId('notice_title').props.children).toBe(CHARGE_MISSING_ALERT.subscription.title);
  });
});

describe('التعديل (بند D)', () => {
  it('تعديل الاسم بس ← nextDueDate مبيتبعتش', async () => {
    await render(wrap());
    await openMenuItem('subscription_edit_s1');
    await act(async () => { fireEvent.changeText(screen.getByDisplayValue('نتفليكس'), 'نتفليكس بريميوم'); });
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_edit_save')); });
    const [, data] = (mockData.updateSubscription as jest.Mock).mock.calls[0];
    expect(data.name).toBe('نتفليكس بريميوم');
    expect('nextDueDate' in data).toBe(false);
  });

  it('المعاد اتغيّر ← بيتبعت', async () => {
    mockData.subscriptions = [sub({ nextDueDate: addDays(today, 1) })];
    mockPickDate = addDays(today, 3);
    await render(wrap());
    await openMenuItem('subscription_edit_s1');
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_edit_due')); });
    await act(async () => { fireEvent.press(screen.getByTestId('pick_date')); });
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_edit_save')); });
    expect((mockData.updateSubscription as jest.Mock).mock.calls[0][1].nextDueDate).toBe(addDays(today, 3));
  });

  it('المعاد اتقدّم بعد مرة متأخرة ما اتسجلتش ← تأكيد قبل الحفظ، و"إلغاء" مبيحفظش', async () => {
    mockData.subscriptions = [sub({ nextDueDate: addDays(today, -5) })];
    mockPickDate = addDays(today, 3);
    await render(wrap());
    await openMenuItem('subscription_edit_s1');
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_edit_due')); });
    await act(async () => { fireEvent.press(screen.getByTestId('pick_date')); });
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_edit_save')); });
    const [title, body] = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
    expect(title).toBe('تغيّر المعاد؟');
    expect(body).toContain('عليه مرة متأخرة لسه ما اتسجلتش');
    expect(mockData.updateSubscription).not.toHaveBeenCalled();
    await pressAlertButton('إلغاء');
    expect(mockData.updateSubscription).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_edit_save')); });
    await pressAlertButton('غيّر المعاد');
    expect((mockData.updateSubscription as jest.Mock).mock.calls[0][1].nextDueDate).toBe(addDays(today, 3));
  });

  it('المعاد جوه فترة اتقفلت ← رسالة الرفض بتبان في الفورم', async () => {
    mockData.updateSubscription = jest.fn(async () => ({ outcome: 'invalid', field: 'nextDueDate', message: 'المعاد الجديد لازم يبقى بعد' }));
    mockData.subscriptions = [sub({ nextDueDate: addDays(today, 5) })];
    mockPickDate = addDays(today, 3);
    await render(wrap());
    await openMenuItem('subscription_edit_s1');
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_edit_due')); });
    await act(async () => { fireEvent.press(screen.getByTestId('pick_date')); });
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_edit_save')); });
    expect(screen.getByText('المعاد الجديد لازم يبقى بعد')).toBeTruthy();
  });
});

describe('المسح (بند H)', () => {
  it('التأكيد بيعدّ عمليات closed وsubscriptionId مش history بس', async () => {
    mockData.subscriptions = [sub({ closed: { [today]: { txId: 'tx_closed', at: 'a' } } } as Partial<Subscription>)];
    mockData.transactions = [
      { id: 'tx_closed', type: 'expense', amount: 200, walletId: W.id, date: today },
      { id: 'tx_stray', type: 'expense', amount: 50, walletId: W.id, date: today, subscriptionId: 's1' },
    ];
    await render(wrap());
    await openMenuItem('subscription_delete_s1');
    const body = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][1] as string;
    expect(body).toMatch(/عمليتين|2/);
  });
});
