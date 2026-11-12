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
import { AMOUNT_CHANGED_ALERT, PAY_OUTCOME_ALERT, PAY_OUTCOME_ALERT_GAMIYA } from '@/context/DataContext';

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
  expect(screen.getByTestId('confirm_body').props.children).toBe('اشتراك "نتفليكس" بتاع 1 يناير 2099 — نسجّل خصم 150 ج.م من الكاش؟ هيتسجل بتاريخ النهارده.');
  expect(mockData.markSubscriptionPaid).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  expect(screen.queryByTestId('confirm_dialog')).toBeNull();
  expect(mockData.markSubscriptionPaid).toHaveBeenCalledWith('s1', today, 150);
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
  expect(screen.getByTestId('confirm_body').props.children).toBe('قسط شهر 1 من جمعية "جمعية الشغل" (1 يوليو 2099) — نسجّل خصم 1,000 ج.م من الكاش؟ هيتسجل بتاريخ المعاد مش النهارده.');
  expect(mockData.markGamiyaMonthDone).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
  expect(screen.queryByTestId('confirm_dialog')).toBeNull();
  expect(mockData.markGamiyaMonthDone).toHaveBeenCalledWith('g1', 'm1', 1000);
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

describe('محفظة مؤرشفة أو ممسوحة: مفيش تأكيد بيوعد بحاجة الكتابة هترفضها', () => {
  const walletStates: [string, unknown[]][] = [['مؤرشفة', [{ ...W, archived: true }]], ['ممسوحة', []]];

  it.each(walletStates)('الاشتراك، محفظة %s ← مفيش تأكيد، ورسالة wallet-missing، ومفيش كتابة', async (_label, wallets) => {
    mockData.wallets = wallets;
    await render(wrap(<SubscriptionsView />));
    await act(async () => { fireEvent.press(screen.getByLabelText('اتخصم اشتراك نتفليكس')); });
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
    expect(screen.getByTestId('notice_title').props.children).toBe(PAY_OUTCOME_ALERT['wallet-missing'].title);
    expect(screen.getByTestId('notice_body').props.children).toBe(PAY_OUTCOME_ALERT['wallet-missing'].body);
    expect(mockData.markSubscriptionPaid).not.toHaveBeenCalled();
  });

  it.each(walletStates)('الجمعية، محفظة %s ← مفيش تأكيد، ورسالة wallet-missing، ومفيش كتابة', async (_label, wallets) => {
    mockData.wallets = wallets;
    await render(wrap(<GamiyaView />));
    await act(async () => { fireEvent.press(screen.getByText('جمعية الشغل')); });
    await act(async () => { fireEvent.press(screen.getAllByText('اتخصم')[0]); });
    expect(screen.queryByTestId('confirm_dialog')).toBeNull();
    expect(screen.getByTestId('notice_title').props.children).toBe(PAY_OUTCOME_ALERT_GAMIYA['wallet-missing'].title);
    expect(screen.getByTestId('notice_body').props.children).toBe(PAY_OUTCOME_ALERT_GAMIYA['wallet-missing'].body);
    expect(mockData.markGamiyaMonthDone).not.toHaveBeenCalled();
  });
});

describe('المبلغ اتعدّل من جهاز تاني والتأكيد مفتوح', () => {
  it('الاشتراك: المبلغ بقى 200 والتأكيد لسه بيقول 150 ← بيبعت 150 (اللي اتشاف)', async () => {
    const view = await render(wrap(<SubscriptionsView />));
    await act(async () => { fireEvent.press(screen.getByLabelText('اتخصم اشتراك نتفليكس')); });
    expect(screen.getByTestId('confirm_body').props.children).toContain('150');
    mockData.subscriptions = [{ ...sub('s1', 'نتفليكس'), amount: 200 }, sub('s2', 'سبوتيفاي')];
    await act(async () => { view.rerender(wrap(<SubscriptionsView />)); });
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
    expect(mockData.markSubscriptionPaid).toHaveBeenCalledWith('s1', today, 150);
  });

  it('الاشتراك: amount-changed ← رسالة "المبلغ اتغيّر"', async () => {
    mockData.markSubscriptionPaid = jest.fn(async () => 'amount-changed');
    await render(wrap(<SubscriptionsView />));
    await act(async () => { fireEvent.press(screen.getByLabelText('اتخصم اشتراك نتفليكس')); });
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
    expect(screen.getByTestId('notice_title').props.children).toBe(AMOUNT_CHANGED_ALERT.subscription.title);
    expect(screen.getByTestId('notice_body').props.children).toBe(AMOUNT_CHANGED_ALERT.subscription.body);
  });

  it('الجمعية: بيبعت قسط الشهر اللي في التأكيد، وamount-changed ← رسالة', async () => {
    mockData.markGamiyaMonthDone = jest.fn(async () => 'amount-changed');
    await render(wrap(<GamiyaView />));
    await act(async () => { fireEvent.press(screen.getByText('جمعية الشغل')); });
    await act(async () => { fireEvent.press(screen.getAllByText('اتخصم')[0]); });
    await act(async () => { fireEvent.press(screen.getByTestId('confirm_action_0')); });
    expect(mockData.markGamiyaMonthDone).toHaveBeenCalledWith('g1', 'm1', 1000);
    expect(screen.getByTestId('notice_body').props.children).toBe(AMOUNT_CHANGED_ALERT.gamiya.body);
  });
});
