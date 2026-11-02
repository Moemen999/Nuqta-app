import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import SubscriptionsView from '@/components/SubscriptionsView';
import GamiyaView from '@/components/GamiyaView';
import { ConfirmProvider } from '@/components/ConfirmProvider';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { BUSY_NOTICE, useBusyKey } from '@/lib/useBusy';
import { todayStr } from '@/lib/finance';

/**
 * نقل التأكيدات — الشاشات المالية بالمكوّن نفسه (silent-failure-hunter + money-reviewer، جولة 1):
 * الدفع والاستلام قبل أي كتابة، التأكيد بيتقفل، شهرين بنفس النص مش بيتبلعوا، ودوسة اتسقطت
 * عشان عملية تانية شغالة بتتقال.
 */

const today = todayStr();
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));
jest.mock('@/context/AppLockContext', () => ({ useAppLock: () => ({ isLocked: false }) }));

const W = { id: 'w1', name: 'الكاش', openingBalance: 0, lowAlert: 0 };
const sub = (id: string, name: string) => ({
  id, name, amount: 150, walletId: W.id, frequency: 'monthly', nextDueDate: '2099-01-01',
  reminderDaysBefore: 1, active: true, history: [], createdAt: '2026-01-01',
});
const gam = {
  id: 'g1', name: 'جمعية الشغل', monthlyAmount: 1000, totalMonths: 3, payoutMonthIndex: 3, payoutAmount: 3000,
  walletId: W.id, startDate: '2026-07-01', reminderDaysBefore: 1, createdAt: '2026-07-01',
  months: [
    { id: 'm1', monthIndex: 1, dueDate: '2099-07-01', amount: 1000, status: 'pending', isPayoutMonth: false },
    { id: 'm2', monthIndex: 2, dueDate: '2099-08-01', amount: 1000, status: 'pending', isPayoutMonth: false },
    { id: 'm3', monthIndex: 3, dueDate: '2099-09-01', amount: 3000, status: 'pending', isPayoutMonth: true },
  ],
};

beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [W], categories: [], transactions: [], loadErrors: [], figuresPending: [],
    subscriptions: [sub('s1', 'نتفليكس'), sub('s2', 'سبوتيفاي')], gamiyas: [gam],
    deleteSubscription: jest.fn(), deleteGamiya: jest.fn(), setSubscriptionActive: jest.fn(async () => 'done'),
    markSubscriptionPaid: jest.fn(async () => 'done'), markGamiyaMonthDone: jest.fn(async () => 'done'),
  });
});

const wrap = (node: React.ReactNode) => <ThemeProvider><NoticeProvider><ConfirmProvider><PrivacyProvider>{node}</PrivacyProvider></ConfirmProvider></NoticeProvider></ThemeProvider>;

it('useBusyKey: دوسة والأولى شغالة ← onBusy بيتنادى وrun بيرجّع false', async () => {
  const onBusy = jest.fn();
  const { result } = await renderHook(() => useBusyKey(onBusy));
  let release!: () => void;
  let first!: Promise<boolean>;
  await act(async () => { first = result.current.run('a', () => new Promise<void>(r => { release = r; })); });
  let second!: boolean;
  await act(async () => { second = await result.current.run('b', jest.fn()); });
  expect(second).toBe(false);
  expect(onBusy).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
  await expect(first).resolves.toBe(true);
});

it('الاشتراك: "اتخصم" ← تأكيد قبل الدفع، بيتقفل، وبعدين الدفع', async () => {
  await render(wrap(<SubscriptionsView />));
  await act(async () => { fireEvent.press(screen.getByLabelText('اتخصم اشتراك نتفليكس')); });
  expect(screen.getByTestId('confirm_title').props.children).toBe('تسجيل الدفع');
  expect(mockData.markSubscriptionPaid).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  expect(screen.queryByTestId('confirm_dialog')).toBeNull();
  expect(mockData.markSubscriptionPaid).toHaveBeenCalledWith('s1', today);
  // دوسة أولى عادية ← مفيش "ما اتنفّذش"
  expect(screen.queryByTestId('notice_title')).toBeNull();
});

it('دفع اشتراك تاني والأول لسه بيلف ← "استنى لحظة" مش سكوت', async () => {
  let release!: () => void;
  mockData.markSubscriptionPaid = jest.fn(() => new Promise<string>(r => { release = () => r('done'); }));
  await render(wrap(<SubscriptionsView />));
  await act(async () => { fireEvent.press(screen.getByLabelText('اتخصم اشتراك نتفليكس')); });
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  await act(async () => { fireEvent.press(screen.getByLabelText('اتخصم اشتراك سبوتيفاي')); });
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  expect(screen.getByTestId('notice_title').props.children).toBe(BUSY_NOTICE.title);
  expect(mockData.markSubscriptionPaid).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
});

it('الجمعية: "اتخصم" للشهر ← تأكيد قبل الكتابة، و"تأكيد" بيسجّل الشهر الصح', async () => {
  await render(wrap(<GamiyaView />));
  await act(async () => { fireEvent.press(screen.getByText('جمعية الشغل')); });
  const pay = screen.getAllByText('اتخصم')[0];
  await act(async () => { fireEvent.press(pay); });
  expect(screen.getByTestId('confirm_title').props.children).toBe('تسجيل القسط');
  expect(mockData.markGamiyaMonthDone).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  expect(screen.queryByTestId('confirm_dialog')).toBeNull();
  expect(mockData.markGamiyaMonthDone).toHaveBeenCalledWith('g1', 'm1');
  expect(screen.queryByTestId('notice_title')).toBeNull();
});

it('الجمعية: شهرين بنفس القسط ورا بعض بسرعة ← التأكيد التاني مش بيتبلع (المفتاح هو الشهر)', async () => {
  await render(wrap(<GamiyaView />));
  await act(async () => { fireEvent.press(screen.getByText('جمعية الشغل')); });
  const [m1, m2] = screen.getAllByText('اتخصم');
  await act(async () => { fireEvent.press(m1); fireEvent.press(m2); });
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_cancel')); });
  // من غير المفتاح، التاني كان هيتلغي لأن نصه زي الأول بالظبط
  expect(screen.getByTestId('confirm_dialog')).toBeTruthy();
});
