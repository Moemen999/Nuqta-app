import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import SubscriptionsView, { SUBSCRIPTION_RESUME_FAIL_ALERT, SUBSCRIPTION_RESUME_WALLET_ALERT, SUBSCRIPTION_STOPPED_ALERT } from '@/components/SubscriptionsView';
import { NoticeProvider } from '@/components/NoticeProvider';
import { PrivacyProvider } from '@/context/PrivacyContext';
import { ThemeProvider } from '@/context/ThemeContext';
import type { Subscription } from '@/context/DataContext';
import { subscriptionOpenCharges, subscriptionResumeDate } from '@/lib/autoCharge';
import { addDays, addMonths, todayStr } from '@/lib/finance';

/**
 * "وقّف الاشتراك" حقيقي (قرار مؤمن 2026-11-02): `active:false`، والكروت والتلقائي والتذكيرات
 * بيتخطوه، والرجوع من أول معاد جاي — المرات اللي فاتت وهو واقف مبتتسجلش.
 */

const today = todayStr();
const mockData: Record<string, unknown> = {};
jest.mock('@/context/DataContext', () => ({ ...jest.requireActual('@/context/DataContext'), useData: () => mockData }));

const W = { id: 'w1', name: 'الكاش', openingBalance: 0, lowAlert: 0 };
const sub = (over: Partial<Subscription> = {}) => ({
  id: 's1', name: 'نتفليكس', amount: 200, walletId: W.id, frequency: 'monthly', nextDueDate: today,
  reminderDaysBefore: 3, active: true, history: [], createdAt: '2026-01-01', ...over,
}) as unknown as Subscription;

describe('subscriptionResumeDate', () => {
  it('واقف من 3 شهور ← أول معاد من النهاردة بنفس الدورة', () => {
    const s = sub({ nextDueDate: addMonths(today, -3) });
    const d = subscriptionResumeDate(s, today);
    expect(d >= today).toBe(true);
    expect(d < addMonths(today, 1)).toBe(true);
  });
  it('المعاد لسه جاي ← زي ما هو', () => {
    expect(subscriptionResumeDate(sub({ nextDueDate: addDays(today, 10) }), today)).toBe(addDays(today, 10));
  });
  it('المعاد النهاردة ← النهاردة', () => {
    expect(subscriptionResumeDate(sub({ nextDueDate: today }), today)).toBe(today);
  });
  it('مخصص كل 10 أيام، واقف من 25 يوم ← بعد 5 أيام', () => {
    expect(subscriptionResumeDate(sub({ frequency: 'custom', customDays: 10, nextDueDate: addDays(today, -25) } as Partial<Subscription>), today)).toBe(addDays(today, 5));
  });
  it('بعد الرجوع "بيتسجل لوحده" مفيش فترات متأخرة مفتوحة (الخطر اللي اتقفل)', () => {
    const stopped = sub({ nextDueDate: addMonths(today, -3), chargeMode: 'auto', chargeAutoSince: addMonths(today, -6) } as Partial<Subscription>);
    // قبل التصليح: الرجوع كان هيسيب nextDueDate قديم ← 3 فترات تلقائي
    expect(subscriptionOpenCharges({ ...stopped, active: true }, today).filter(c => c.due < today)).toHaveLength(3);
    const resumed = { ...stopped, active: true, nextDueDate: subscriptionResumeDate(stopped, today) };
    expect(subscriptionOpenCharges(resumed, today).filter(c => c.due < today)).toHaveLength(0);
  });
  it('الواقف نفسه مبيطلعش فترات (غير اللي رجعت تسأل)', () => {
    expect(subscriptionOpenCharges(sub({ active: false, nextDueDate: addMonths(today, -2) }), today)).toHaveLength(0);
  });
});

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  for (const k of Object.keys(mockData)) delete mockData[k];
  Object.assign(mockData, {
    wallets: [W], categories: [], transactions: [], loadErrors: [], figuresPending: [],
    subscriptions: [sub(), sub({ id: 's2', name: 'سبوتيفاي', active: false, nextDueDate: addMonths(today, -2) })],
    deleteSubscription: jest.fn(), markSubscriptionPaid: jest.fn(async () => 'done'),
    setSubscriptionActive: jest.fn(async () => 'done'),
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

const wrap = () => <ThemeProvider><NoticeProvider><PrivacyProvider><SubscriptionsView /></PrivacyProvider></NoticeProvider></ThemeProvider>;
async function pressAlertButton(text: string) {
  const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as { text: string; onPress?: () => unknown }[];
  await act(async () => { await buttons.find(b => b.text === text)?.onPress?.(); });
}

/** "وقّف" جوه قايمة "⋯" (دراسة الشكل خطوة 3) — بيستنى الورقة تختفي على iOS (افتراضي jest-expo) */
async function pressStop(id: string) {
  await act(async () => { fireEvent.press(screen.getByTestId(`subscription_more_${id}`)); });
  await act(async () => { fireEvent.press(screen.getByTestId(`subscription_stop_${id}`)); });
  await act(async () => { await new Promise(r => setTimeout(r, 650)); });
}

describe('شاشة الاشتراكات', () => {
  it('الواقف في "اشتراكات واقفة" المطوي، والشغال باين بزرار "وقّف"', async () => {
    await render(wrap());
    expect(screen.getByText('نتفليكس')).toBeTruthy();
    expect(screen.queryByText('سبوتيفاي')).toBeNull();
    expect(screen.getByText('اشتراكات واقفة (1)')).toBeTruthy();
    expect(screen.getByTestId('subscriptions_stopped_toggle').props.accessibilityLabel).toBe('اشتراكات واقفة، اشتراك واحد');
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_more_s1')); });
    expect(screen.getByTestId('subscription_stop_s1')).toBeTruthy();
  });

  it('الواقف: مفيش "اتخصم" ولا "وقّف"، وفيه "رجّعه" وسطر "واقف"', async () => {
    await render(wrap());
    await act(async () => { fireEvent.press(screen.getByTestId('subscriptions_stopped_toggle')); });
    expect(screen.getAllByText('اتخصم')).toHaveLength(1); // بتاع نتفليكس بس
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_more_s2')); });
    expect(screen.queryByTestId('subscription_stop_s2')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_menu_cancel')); });
    expect(screen.getByTestId('subscription_resume_s2')).toBeTruthy();
    expect(screen.getByText('واقف مؤقتًا — مش هيتخصم ولا هيفكّرك لحد ما ترجّعه')).toBeTruthy();
  });

  it('"وقّف" ← تأكيد ثم setSubscriptionActive(false)', async () => {
    await render(wrap());
    await pressStop('s1');
    expect(alertSpy.mock.calls[0][0]).toBe('توقّف الاشتراك ده مؤقتًا؟');
    expect(mockData.setSubscriptionActive).not.toHaveBeenCalled();
    await pressAlertButton('وقّفه');
    expect(mockData.setSubscriptionActive).toHaveBeenCalledWith('s1', false);
  });

  it('"رجّعه" ← التأكيد بيقول المعاد الجاي وإن اللي فات مش هيتسجل', async () => {
    await render(wrap());
    await act(async () => { fireEvent.press(screen.getByTestId('subscriptions_stopped_toggle')); });
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_resume_s2')); });
    const [title, body] = alertSpy.mock.calls[0];
    expect(title).toBe('ترجّع الاشتراك ده؟');
    expect(body).toContain(subscriptionResumeDate(sub({ nextDueDate: addMonths(today, -2) }), today));
    expect(body).toContain('المرات اللي فاتت مش هتتسجل، إلا اللي مستنية ردك في الرئيسية');
    await pressAlertButton('رجّعه');
    expect(mockData.setSubscriptionActive).toHaveBeenCalledWith('s2', true);
  });

  it('رجوع ومحفظته مؤرشفة ← رسالة "محتاج محفظة تانية"', async () => {
    mockData.setSubscriptionActive = jest.fn(async () => 'wallet-missing');
    await render(wrap());
    await act(async () => { fireEvent.press(screen.getByTestId('subscriptions_stopped_toggle')); });
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_resume_s2')); });
    await pressAlertButton('رجّعه');
    expect(screen.getByTestId('notice_title').props.children).toBe(SUBSCRIPTION_RESUME_WALLET_ALERT.title);
  });

  it('"اتخصم" على اشتراك اتوقف من جهاز تاني ← رسالة "واقف"', async () => {
    mockData.markSubscriptionPaid = jest.fn(async () => 'stopped');
    await render(wrap());
    await act(async () => { fireEvent.press(screen.getByText('اتخصم')); });
    await pressAlertButton('تأكيد');
    expect(screen.getByTestId('notice_title').props.children).toBe(SUBSCRIPTION_STOPPED_ALERT.title);
  });

  it('كلهم واقفين ← "مفيش اشتراكات شغالة دلوقتي" مش "مفيش اشتراكات مسجلة"', async () => {
    mockData.subscriptions = [sub({ active: false })];
    await render(wrap());
    expect(screen.getByText('مفيش اشتراكات شغالة دلوقتي')).toBeTruthy();
    expect(screen.queryByText('مفيش اشتراكات مسجلة')).toBeNull();
  });
});

describe('الجولة 1: تحذير المتأخر، رسايل الرجوع، والليبلز', () => {
  it('وقّف وعليه مرة متأخرة ما اتسجلتش ← التأكيد بيقول إنها مش هتتسجل لو رجّعته', async () => {
    mockData.subscriptions = [sub({ nextDueDate: addDays(today, -5) })];
    await render(wrap());
    await pressStop('s1');
    expect(alertSpy.mock.calls[0][1]).toContain('عليه مرة متأخرة لسه ما اتسجلتش');
  });

  it('وقّف ومفيش متأخر ← مفيش سطر تحذير', async () => {
    mockData.subscriptions = [sub({ nextDueDate: addDays(today, 5) })];
    await render(wrap());
    await pressStop('s1');
    expect(alertSpy.mock.calls[0][1]).not.toContain('متأخرة');
  });

  it('رجوع من غير نت ← "الاشتراك لسه واقف"', async () => {
    mockData.setSubscriptionActive = jest.fn(async () => 'no-connection');
    await render(wrap());
    await act(async () => { fireEvent.press(screen.getByTestId('subscriptions_stopped_toggle')); });
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_resume_s2')); });
    await pressAlertButton('رجّعه');
    expect(screen.getByTestId('notice_title').props.children).toBe(SUBSCRIPTION_RESUME_FAIL_ALERT['no-connection'].title);
  });

  it('الأزرار بتقول اسم الاشتراك لقارئ الشاشة', async () => {
    await render(wrap());
    // "⋯" باسم الاشتراك، والقايمة عنوانها اسمه (الفعل جوّاها بنصّه)
    expect(screen.getByLabelText('باقي الاختيارات لاشتراك نتفليكس')).toBeTruthy();
    expect(screen.getByLabelText('اتخصم اشتراك نتفليكس')).toBeTruthy();
  });

  it('واقف وفيه مرة رجعت تسأل ← الكارت بيقول إنها مستنية في الرئيسية', async () => {
    mockData.subscriptions = [sub({ active: false, nextDueDate: addDays(today, 10), closed: { [addDays(today, -3)]: { reopened: true } } } as Partial<Subscription>)];
    await render(wrap());
    await act(async () => { fireEvent.press(screen.getByTestId('subscriptions_stopped_toggle')); });
    expect(screen.getByText(/لسه فيه مرة مستنية ردك في الرئيسية/)).toBeTruthy();
  });
});

describe('الجولة 2', () => {
  it('رجوع اشتراك اتمسح من جهاز تاني ← "الاشتراك ده اتمسح" مش "رجّعنا"', async () => {
    mockData.setSubscriptionActive = jest.fn(async () => 'missing');
    await render(wrap());
    await act(async () => { fireEvent.press(screen.getByTestId('subscriptions_stopped_toggle')); });
    await act(async () => { fireEvent.press(screen.getByTestId('subscription_resume_s2')); });
    await pressAlertButton('رجّعه');
    expect(screen.getByTestId('notice_title').props.children).toBe('الاشتراك ده اتمسح');
  });

  it('تحذير الإيقاف مبيعدّش المرة اللي رجعت تسأل (بتفضل تسأل بعد الرجوع)', async () => {
    const back = addDays(today, -3);
    mockData.subscriptions = [sub({ nextDueDate: addDays(today, 10), closed: { [back]: { reopened: true } } } as Partial<Subscription>)];
    await render(wrap());
    await pressStop('s1');
    expect(alertSpy.mock.calls[0][1]).not.toContain('متأخرة');
  });
});
